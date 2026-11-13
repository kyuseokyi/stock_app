"""이용약관 동의(D3) — terms_required 판정, UserOut.terms_required, POST /me/terms, 댓글 작성 403.

DB 는 sqlite in-memory, 인증은 실제 JWT(sid 없는 토큰 — 레거시 경로)로 한다.
"""
from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.main import app as auth_app
from apps.auth.terms import TERMS_VERSION, terms_required
from apps.blog.main import app as blog_app
from shared.database import get_db
from shared.models import Base, BlogPost, Board, User, UserRole
from shared.security import create_access_token

ME = "/api/v1/auth/me"
TERMS = "/api/v1/auth/me/terms"


# ── 판정 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("role", "version", "expected"),
    [
        (UserRole.ADMIN, None, False),        # 관리자는 항상 false
        (UserRole.ADMIN, "2000-01-01", False),
        (UserRole.FREE, None, True),          # 미동의(NULL)
        (UserRole.FREE, "2000-01-01", True),  # 옛 버전
        (UserRole.FREE, TERMS_VERSION, False),  # 현재 버전
        (UserRole.PREMIUM, TERMS_VERSION, False),
    ],
)
def test_terms_required(role, version, expected):
    assert terms_required(SimpleNamespace(role=role, terms_version=version)) is expected


def test_terms_version_constant():
    assert TERMS_VERSION == "2026-11-13"


# ── 픽스처 ────────────────────────────────────────────


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def _override(app, maker):
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db


@pytest.fixture
async def auth_client(maker):
    _override(auth_app, maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://test") as c:
        yield c
    auth_app.dependency_overrides.clear()


@pytest.fixture
async def blog_client(maker):
    _override(blog_app, maker)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=blog_app), base_url="http://test") as c:
        yield c
    blog_app.dependency_overrides.clear()


async def _seed_user(maker, *, role=UserRole.FREE, version=None, email="u@test.local") -> User:
    async with maker() as db:
        user = User(email=email, nickname="회원", role=role, is_active=True, terms_version=version)
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=user.id, role=user.role.value)}"}


# ── UserOut.terms_required ────────────────────────────


async def test_me_includes_terms_required_true_for_null(auth_client, maker):
    user = await _seed_user(maker)
    r = await auth_client.get(ME, headers=_auth(user))
    assert r.status_code == 200, r.text
    body = r.json()
    # 기존 필드 유지 + 순서(새 필드는 맨 끝)
    assert list(body.keys()) == ["id", "email", "nickname", "role", "terms_required"]
    assert body["terms_required"] is True


async def test_me_terms_required_false_when_current(auth_client, maker):
    user = await _seed_user(maker, version=TERMS_VERSION)
    r = await auth_client.get(ME, headers=_auth(user))
    assert r.json()["terms_required"] is False


async def test_me_admin_terms_required_false(auth_client, maker):
    user = await _seed_user(maker, role=UserRole.ADMIN)
    r = await auth_client.get(ME, headers=_auth(user))
    assert r.json()["terms_required"] is False


async def test_guest_login_user_has_terms_required(auth_client, monkeypatch):
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")
    r = await auth_client.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "app"})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["terms_required"] is True

    # refresh 응답(result.user 경로)에도 들어간다
    r2 = await auth_client.post("/api/v1/auth/refresh", json={"refresh_token": r.json()["refresh_token"]})
    assert r2.status_code == 200, r2.text
    assert r2.json()["user"]["terms_required"] is True


# ── POST /me/terms ────────────────────────────────────


async def test_agree_terms_success_and_idempotent(auth_client, maker):
    user = await _seed_user(maker)
    r = await auth_client.post(TERMS, json={"version": TERMS_VERSION}, headers=_auth(user))
    assert r.status_code == 200, r.text
    assert r.json()["terms_required"] is False
    assert r.json()["id"] == user.id

    async with maker() as db:
        saved = await db.get(User, user.id)
        assert saved.terms_version == TERMS_VERSION
        assert saved.terms_agreed_at is not None
        first_at = saved.terms_agreed_at

    # 이미 동의했어도 200(멱등)
    r2 = await auth_client.post(TERMS, json={"version": TERMS_VERSION}, headers=_auth(user))
    assert r2.status_code == 200
    assert r2.json()["terms_required"] is False
    async with maker() as db:
        assert (await db.get(User, user.id)).terms_agreed_at >= first_at

    me = await auth_client.get(ME, headers=_auth(user))
    assert me.json()["terms_required"] is False


async def test_agree_terms_version_mismatch_409(auth_client, maker):
    user = await _seed_user(maker)
    r = await auth_client.post(TERMS, json={"version": "2000-01-01"}, headers=_auth(user))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "TERMS_VERSION_MISMATCH"
    assert r.json()["detail"]["message"]
    async with maker() as db:
        assert (await db.get(User, user.id)).terms_version is None


async def test_agree_terms_unauthenticated_401(auth_client):
    r = await auth_client.post(TERMS, json={"version": TERMS_VERSION})
    assert r.status_code == 401


# ── 댓글 작성 게이트 ──────────────────────────────────


async def _seed_post(maker) -> BlogPost:
    async with maker() as db:
        board = Board(name="자유", order_index=0)
        db.add(board)
        await db.commit()
        await db.refresh(board)
        post = BlogPost(board_id=board.id, title="글", content="<p>x</p>")
        db.add(post)
        await db.commit()
        await db.refresh(post)
        return post


def _comments(post: BlogPost) -> str:
    return f"/api/v1/blogs/{post.id}/comments"


async def test_comment_requires_terms_403(blog_client, maker):
    post = await _seed_post(maker)
    user = await _seed_user(maker)
    r = await blog_client.post(_comments(post), json={"content": "안녕"}, headers=_auth(user))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "TERMS_REQUIRED"


async def test_comment_old_terms_version_403(blog_client, maker):
    post = await _seed_post(maker)
    user = await _seed_user(maker, version="2000-01-01")
    r = await blog_client.post(_comments(post), json={"content": "안녕"}, headers=_auth(user))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "TERMS_REQUIRED"


async def test_comment_allowed_after_terms(blog_client, maker):
    post = await _seed_post(maker)
    user = await _seed_user(maker, version=TERMS_VERSION)
    r = await blog_client.post(_comments(post), json={"content": "안녕"}, headers=_auth(user))
    assert r.status_code == 201, r.text
    assert r.json()["content"] == "안녕"


async def test_comment_admin_bypasses_terms(blog_client, maker):
    post = await _seed_post(maker)
    admin = await _seed_user(maker, role=UserRole.ADMIN, email="a@test.local")
    r = await blog_client.post(_comments(post), json={"content": "공지"}, headers=_auth(admin))
    assert r.status_code == 201, r.text


def test_agreed_at_is_utc_aware():
    """모델 컬럼이 timezone 포함 DateTime 인지(마이그레이션과 일치)."""
    col = User.__table__.c.terms_agreed_at
    assert col.type.timezone is True
    assert col.nullable is True
    assert User.__table__.c.terms_version.type.length == 20

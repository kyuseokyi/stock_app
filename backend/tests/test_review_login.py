"""심사 전용 로그인(D1) — POST /api/v1/auth/review-login + REVIEW_LOGIN_EMAILS 게이트, seed_reviewer.

게이트는 요청 시점에 env 를 읽는다. 로컬은 shared/env.py 가 `.env.development` 를 로드할 수 있으므로
각 테스트가 키를 먼저 지우고 필요한 값만 넣는다.
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth import seed_reviewer
from apps.auth.main import app
from shared.database import get_db
from shared.models import Base, User, UserRole
from shared.security import hash_password, verify_password

URL = "/api/v1/auth/review-login"
EMAIL = "review@funnote.test"
PASSWORD = "review-pass-1234"
BAD_CRED = "이메일 또는 비밀번호가 올바르지 않습니다."


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(maker):
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def allow(monkeypatch):
    monkeypatch.delenv("REVIEW_LOGIN_EMAILS", raising=False)

    def _set(value: str) -> None:
        monkeypatch.setenv("REVIEW_LOGIN_EMAILS", value)

    return _set


async def _seed(maker, *, email=EMAIL, password=PASSWORD, role=UserRole.FREE, active=True, with_hash=True):
    async with maker() as db:
        user = User(
            email=email, nickname="App Review", role=role, is_active=active,
            password_hash=hash_password(password) if with_hash else None,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


def _body(email=EMAIL, password=PASSWORD, platform="app"):
    return {"email": email, "password": password, "platform": platform}


# ── 게이트 ────────────────────────────────────────────


@pytest.mark.parametrize("value", [None, "", " , ", " "])
async def test_disabled_returns_404(client, maker, allow, value):
    if value is not None:
        allow(value)
    await _seed(maker)
    r = await client.post(URL, json=_body())
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}


async def test_disabled_hides_validation(client, allow):
    """꺼져 있으면 본문 검증(422)보다 먼저 404."""
    r = await client.post(URL, json={})
    assert r.status_code == 404


# ── 실패 ──────────────────────────────────────────────


async def test_email_not_in_allowlist_401(client, maker, allow):
    allow("someone-else@funnote.test")
    await _seed(maker)
    r = await client.post(URL, json=_body())
    assert r.status_code == 401
    assert r.json()["detail"] == BAD_CRED


async def test_unknown_user_401(client, allow):
    allow(EMAIL)
    r = await client.post(URL, json=_body())
    assert r.status_code == 401
    assert r.json()["detail"] == BAD_CRED


async def test_no_password_hash_401(client, maker, allow):
    allow(EMAIL)
    await _seed(maker, with_hash=False)
    r = await client.post(URL, json=_body())
    assert r.status_code == 401


async def test_wrong_password_401(client, maker, allow):
    allow(EMAIL)
    await _seed(maker)
    r = await client.post(URL, json=_body(password="wrong-password-xx"))
    assert r.status_code == 401
    assert r.json()["detail"] == BAD_CRED


async def test_admin_rejected_401(client, maker, allow):
    allow(EMAIL)
    await _seed(maker, role=UserRole.ADMIN)
    r = await client.post(URL, json=_body())
    assert r.status_code == 401
    assert r.json()["detail"] == BAD_CRED


async def test_inactive_403(client, maker, allow):
    allow(EMAIL)
    await _seed(maker, active=False)
    r = await client.post(URL, json=_body())
    assert r.status_code == 403


async def test_inactive_wrong_password_still_401(client, maker, allow):
    """비밀번호 확인 전에 비활성 여부를 드러내지 않는다."""
    allow(EMAIL)
    await _seed(maker, active=False)
    r = await client.post(URL, json=_body(password="wrong-password-xx"))
    assert r.status_code == 401


async def test_admin_platform_rejected_422(client, maker, allow):
    allow(EMAIL)
    await _seed(maker)
    r = await client.post(URL, json=_body(platform="admin"))
    assert r.status_code == 422


# ── 성공 ──────────────────────────────────────────────


async def test_success_app_includes_refresh(client, maker, allow):
    allow(f"other@funnote.test, {EMAIL.upper()} ")  # 공백·대소문자 무관
    user = await _seed(maker)
    r = await client.post(URL, json=_body())
    assert r.status_code == 200, r.text
    body = r.json()
    assert r.headers["cache-control"] == "no-store"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["expires_in"]
    assert body["user"]["id"] == user.id
    assert body["user"]["terms_required"] is True

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == EMAIL


async def test_success_web_no_refresh(client, maker, allow):
    allow(EMAIL)
    await _seed(maker)
    r = await client.post(URL, json=_body(platform="web"))
    assert r.status_code == 200, r.text
    assert r.json()["refresh_token"] is None
    assert r.json()["expires_in"] is None


# ── 시드 ──────────────────────────────────────────────


async def test_seed_creates_and_updates(maker, capsys):
    action = await seed_reviewer.seed(EMAIL, PASSWORD, session_factory=maker)
    assert action == "created"
    async with maker() as db:
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one()
        assert user.nickname == "App Review"
        assert user.role == UserRole.FREE
        assert user.provider is None
        assert user.is_active is True
        assert verify_password(PASSWORD, user.password_hash)

    new_pw = "another-pass-5678"
    action = await seed_reviewer.seed(EMAIL, new_pw, session_factory=maker)
    assert action == "updated"
    async with maker() as db:
        users = (await db.execute(select(User).where(User.email == EMAIL))).scalars().all()
        assert len(users) == 1
        assert verify_password(new_pw, users[0].password_hash)
        assert not verify_password(PASSWORD, users[0].password_hash)

    out = capsys.readouterr().out
    assert PASSWORD not in out
    assert new_pw not in out


async def test_seed_refuses_admin_account(maker):
    await _seed(maker, role=UserRole.ADMIN)
    with pytest.raises(SystemExit) as e:
        await seed_reviewer.seed(EMAIL, "another-pass-5678", session_factory=maker)
    assert e.value.code != 0
    async with maker() as db:
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one()
        assert verify_password(PASSWORD, user.password_hash)  # 그대로


@pytest.mark.parametrize(
    ("email", "password"),
    [(None, PASSWORD), (EMAIL, None), (EMAIL, "short-11chr"), ("", PASSWORD)],
)
def test_seed_env_validation_exits(monkeypatch, capsys, email, password):
    monkeypatch.delenv("REVIEW_EMAIL", raising=False)
    monkeypatch.delenv("REVIEW_PASSWORD", raising=False)
    if email is not None:
        monkeypatch.setenv("REVIEW_EMAIL", email)
    if password is not None:
        monkeypatch.setenv("REVIEW_PASSWORD", password)
    with pytest.raises(SystemExit) as e:
        seed_reviewer.read_env()
    assert e.value.code != 0
    captured = capsys.readouterr()
    if password:
        assert password not in captured.out + captured.err


def test_seed_env_ok(monkeypatch):
    monkeypatch.setenv("REVIEW_EMAIL", f" {EMAIL} ")
    monkeypatch.setenv("REVIEW_PASSWORD", PASSWORD)
    assert seed_reviewer.read_env() == (EMAIL, PASSWORD)

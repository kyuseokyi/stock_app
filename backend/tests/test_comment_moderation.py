"""댓글 신고·차단·작성 금지(D8) — 기본값 끄기, 신고 규칙, 목록 필터, 차단 CRUD, 작성 금지 403.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §1·§2
DB 는 sqlite in-memory, 인증은 실제 JWT(sid 없는 토큰 — 레거시 경로)로 한다.
"""
from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.terms import TERMS_VERSION
from apps.blog import schemas
from apps.blog.main import app as blog_app
from shared.database import get_db
from shared.models import Base, BlogComment, BlogPost, Board, CommentReport, User, UserBlock, UserRole
from shared.security import create_access_token

# ── 픽스처 ────────────────────────────────────────────


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

    blog_app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=blog_app), base_url="http://test") as c:
        yield c
    blog_app.dependency_overrides.clear()


async def _user(maker, name: str, *, role=UserRole.FREE, banned=False) -> User:
    async with maker() as db:
        u = User(email=f"{name}@test.local", nickname=name, role=role, is_active=True, terms_version=TERMS_VERSION,
                 comment_banned_at=datetime.now(timezone.utc) if banned else None)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


async def _post(maker, *, comments_enabled=True) -> BlogPost:
    async with maker() as db:
        board = Board(name="자유", order_index=0, comments_enabled=comments_enabled)
        db.add(board)
        await db.commit()
        post = BlogPost(board_id=board.id, title="글", content="<p>x</p>")
        db.add(post)
        await db.commit()
        await db.refresh(post)
        return post


async def _comment(maker, post: BlogPost, author: User, content="댓글") -> BlogComment:
    async with maker() as db:
        c = BlogComment(post_id=post.id, author_id=author.id, content=content)
        db.add(c)
        await db.commit()
        await db.refresh(c)
        return c


def _auth(u: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=u.id, role=u.role.value)}"}


def _list_url(post: BlogPost) -> str:
    return f"/api/v1/blogs/{post.id}/comments"


def _report_url(c: BlogComment) -> str:
    return f"/api/v1/comments/{c.id}/reports"


# ── 1절: 댓글 기본값 끄기 ────────────────────────────


def test_board_model_default_false():
    col = Board.__table__.c.comments_enabled
    assert col.default.arg is False
    assert str(col.server_default.arg) == "false"


def test_board_create_schema_default_false():
    assert schemas.BoardCreate(name="새 게시판").comments_enabled is False


async def test_new_board_via_api_is_comments_off(client, maker):
    admin = await _user(maker, "admin", role=UserRole.ADMIN)
    r = await client.post("/api/v1/boards", json={"name": "공지"}, headers=_auth(admin))
    assert r.status_code == 201, r.text
    assert r.json()["comments_enabled"] is False


def _migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "c4d6e8f0a2b3_comment_report_block.py"
    spec = importlib.util.spec_from_file_location("mig_comment_report_block", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, path.read_text()


def test_migration_meta_and_server_default_only():
    mod, text = _migration()
    assert mod.revision == "c4d6e8f0a2b3" and mod.down_revision == "b3e5f7a9c1d4"
    # 기존 게시판 행은 그대로 — server_default 만 바꾸고 UPDATE 하지 않는다
    assert "UPDATE" not in text.upper().replace("ONUPDATE", "")
    assert "op.execute" not in text
    assert 'server_default=sa.text("false")' in text


# ── 2절: 신고 ─────────────────────────────────────────


async def test_report_success(client, maker):
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    r = await client.post(_report_url(c), json={"reason": "abuse"}, headers=_auth(reporter))
    assert r.status_code == 201, r.text
    assert r.json() == {"ok": True, "hidden": False}
    async with maker() as db:
        rows = (await db.execute(select(CommentReport))).scalars().all()
        assert len(rows) == 1 and rows[0].status == "pending" and rows[0].reason == "abuse"


async def test_report_duplicate_409(client, maker):
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    await client.post(_report_url(c), json={"reason": "spam"}, headers=_auth(reporter))
    r = await client.post(_report_url(c), json={"reason": "spam"}, headers=_auth(reporter))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "ALREADY_REPORTED"


async def test_report_own_comment_400(client, maker):
    post = await _post(maker)
    author = await _user(maker, "작성자")
    c = await _comment(maker, post, author)
    r = await client.post(_report_url(c), json={"reason": "spam"}, headers=_auth(author))
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "CANNOT_REPORT_OWN"


@pytest.mark.parametrize("body", [{"reason": "other"}, {"reason": "other", "detail": "  "},
                                  {"reason": "other", "detail": "가" * 201}, {"reason": "nope"}])
async def test_report_invalid_body_422(client, maker, body):
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    r = await client.post(_report_url(c), json=body, headers=_auth(reporter))
    assert r.status_code == 422


async def test_report_other_with_detail_ok(client, maker):
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    r = await client.post(_report_url(c), json={"reason": "other", "detail": "광고 링크"}, headers=_auth(reporter))
    assert r.status_code == 201, r.text


async def test_report_requires_login_and_404(client, maker):
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    assert (await client.post(_report_url(c), json={"reason": "spam"})).status_code == 401
    r = await client.post("/api/v1/comments/9999/reports", json={"reason": "spam"}, headers=_auth(reporter))
    assert r.status_code == 404


async def test_third_reporter_hides_comment(client, maker):
    post = await _post(maker)
    author = await _user(maker, "작성자")
    c = await _comment(maker, post, author)
    reporters = [await _user(maker, f"신고{i}") for i in range(3)]
    results = []
    for u in reporters:
        r = await client.post(_report_url(c), json={"reason": "abuse"}, headers=_auth(u))
        results.append(r.json()["hidden"])
    assert results == [False, False, True]
    async with maker() as db:
        assert (await db.get(BlogComment, c.id)).hidden_at is not None


async def test_hide_threshold_env(client, maker, monkeypatch):
    monkeypatch.setenv("COMMENT_HIDE_THRESHOLD", "1")
    post = await _post(maker)
    author, reporter = await _user(maker, "작성자"), await _user(maker, "신고자")
    c = await _comment(maker, post, author)
    r = await client.post(_report_url(c), json={"reason": "abuse"}, headers=_auth(reporter))
    assert r.json()["hidden"] is True


async def test_dismissed_reports_not_counted_for_rehide(client, maker):
    """기각된 신고는 숨김 기준에 다시 세지 않는다 — 기각 뒤 새 신고 1건으로 바로 다시 가려지지 않게."""
    post = await _post(maker)
    author = await _user(maker, "작성자")
    c = await _comment(maker, post, author)
    async with maker() as db:
        for i in range(3):
            u = User(email=f"old{i}@t.l", nickname=f"old{i}", role=UserRole.FREE, is_active=True)
            db.add(u)
            await db.flush()
            db.add(CommentReport(comment_id=c.id, reporter_id=u.id, reason="spam", status="dismissed"))
        await db.commit()
    newbie = await _user(maker, "새신고")
    r = await client.post(_report_url(c), json={"reason": "spam"}, headers=_auth(newbie))
    assert r.json()["hidden"] is False


# ── 목록 필터 ─────────────────────────────────────────


async def test_list_anonymous_has_new_fields_and_keeps_old(client, maker):
    post = await _post(maker)
    author = await _user(maker, "작성자")
    await _comment(maker, post, author, "안녕")
    r = await client.get(_list_url(post))
    assert r.status_code == 200
    item = r.json()[0]
    assert list(item.keys()) == ["id", "post_id", "author_id", "author_name", "content", "created_at",
                                 "updated_at", "hidden", "is_mine"]
    assert item["content"] == "안녕" and item["author_name"] == "작성자"
    assert item["hidden"] is False and item["is_mine"] is False


async def test_list_is_mine(client, maker):
    post = await _post(maker)
    me, other = await _user(maker, "나"), await _user(maker, "남")
    await _comment(maker, post, me, "내 것")
    await _comment(maker, post, other, "남 것")
    body = (await client.get(_list_url(post), headers=_auth(me))).json()
    assert [(i["content"], i["is_mine"]) for i in body] == [("내 것", True), ("남 것", False)]


async def test_list_invalid_token_401(client, maker):
    """토큰을 보냈는데 잘못됐으면 익명으로 흘리지 않는다 — 만료면 앱이 리프레시하도록 401."""
    post = await _post(maker)
    r = await client.get(_list_url(post), headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_list_excludes_blocked_and_self_reported(client, maker):
    post = await _post(maker)
    me, bad, spam, ok = [await _user(maker, n) for n in ("나", "차단대상", "스팸", "정상")]
    await _comment(maker, post, bad, "차단된 사람 글")
    spam_c = await _comment(maker, post, spam, "신고할 글")
    await _comment(maker, post, ok, "정상 글")
    assert (await client.post(f"/api/v1/me/blocks/{bad.id}", headers=_auth(me))).status_code == 201
    assert (await client.post(_report_url(spam_c), json={"reason": "spam"}, headers=_auth(me))).status_code == 201

    mine = [i["content"] for i in (await client.get(_list_url(post), headers=_auth(me))).json()]
    assert mine == ["정상 글"]
    # 다른 사람(익명)에게는 그대로 보인다
    anon = [i["content"] for i in (await client.get(_list_url(post))).json()]
    assert anon == ["차단된 사람 글", "신고할 글", "정상 글"]


async def test_list_hidden_masked_for_users_raw_for_admin(client, maker):
    post = await _post(maker)
    author, viewer = await _user(maker, "작성자"), await _user(maker, "구경")
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    c = await _comment(maker, post, author, "나쁜 말")
    async with maker() as db:
        row = await db.get(BlogComment, c.id)
        row.hidden_at = datetime.now(timezone.utc)
        await db.commit()

    for headers in ({}, _auth(viewer), _auth(author)):
        item = (await client.get(_list_url(post), headers=headers)).json()[0]
        assert item["hidden"] is True and item["content"] == "" and item["author_name"] is None
    item = (await client.get(_list_url(post), headers=_auth(admin))).json()[0]
    assert item["hidden"] is True and item["content"] == "나쁜 말" and item["author_name"] == "작성자"


# ── 차단 ──────────────────────────────────────────────


async def test_block_crud(client, maker):
    me, a, b = await _user(maker, "나"), await _user(maker, "에이"), await _user(maker, "비")
    assert (await client.post(f"/api/v1/me/blocks/{a.id}", headers=_auth(me))).status_code == 201
    assert (await client.post(f"/api/v1/me/blocks/{a.id}", headers=_auth(me))).status_code == 200  # 멱등
    assert (await client.post(f"/api/v1/me/blocks/{b.id}", headers=_auth(me))).status_code == 201
    r = await client.get("/api/v1/me/blocks", headers=_auth(me))
    assert r.status_code == 200
    body = r.json()
    assert [x["user_id"] for x in body] == [b.id, a.id]  # 최신순
    assert body[0]["nickname"] == "비" and body[0]["blocked_at"]
    assert set(body[0].keys()) == {"user_id", "nickname", "blocked_at"}

    assert (await client.delete(f"/api/v1/me/blocks/{a.id}", headers=_auth(me))).status_code == 204
    assert (await client.delete(f"/api/v1/me/blocks/{a.id}", headers=_auth(me))).status_code == 204  # 없어도 204
    assert [x["user_id"] for x in (await client.get("/api/v1/me/blocks", headers=_auth(me))).json()] == [b.id]


async def test_block_list_does_not_leak_email(client, maker):
    me = await _user(maker, "나")
    async with maker() as db:
        noname = User(email="secret@test.local", nickname=None, role=UserRole.FREE, is_active=True)
        db.add(noname)
        await db.commit()
        await db.refresh(noname)
    await client.post(f"/api/v1/me/blocks/{noname.id}", headers=_auth(me))
    body = (await client.get("/api/v1/me/blocks", headers=_auth(me))).json()
    assert body[0]["nickname"] is None


async def test_block_self_and_admin_400(client, maker):
    me = await _user(maker, "나")
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    r = await client.post(f"/api/v1/me/blocks/{me.id}", headers=_auth(me))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "CANNOT_BLOCK_SELF"
    r = await client.post(f"/api/v1/me/blocks/{admin.id}", headers=_auth(me))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "CANNOT_BLOCK_ADMIN"


async def test_block_unknown_user_404_and_requires_login(client, maker):
    me = await _user(maker, "나")
    assert (await client.post("/api/v1/me/blocks/9999", headers=_auth(me))).status_code == 404
    assert (await client.get("/api/v1/me/blocks")).status_code == 401
    assert (await client.post(f"/api/v1/me/blocks/{me.id}")).status_code == 401


async def test_user_block_model_composite_pk():
    assert [c.name for c in UserBlock.__table__.primary_key.columns] == ["blocker_id", "blocked_id"]


# ── 작성 금지 ─────────────────────────────────────────


async def test_banned_user_cannot_comment_403(client, maker):
    post = await _post(maker)
    banned = await _user(maker, "금지", banned=True)
    r = await client.post(_list_url(post), json={"content": "글"}, headers=_auth(banned))
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "COMMENT_BANNED"


async def test_banned_check_after_terms(client, maker):
    """약관 미동의 + 작성 금지면 TERMS_REQUIRED 가 먼저."""
    post = await _post(maker)
    async with maker() as db:
        u = User(email="x@t.l", nickname="x", role=UserRole.FREE, is_active=True,
                 comment_banned_at=datetime.now(timezone.utc))
        db.add(u)
        await db.commit()
        await db.refresh(u)
    r = await client.post(_list_url(post), json={"content": "글"}, headers=_auth(u))
    assert r.json()["detail"]["code"] == "TERMS_REQUIRED"


async def test_banned_user_cannot_edit_but_can_delete(client, maker):
    post = await _post(maker)
    banned = await _user(maker, "금지", banned=True)
    c = await _comment(maker, post, banned)
    r = await client.put(f"/api/v1/comments/{c.id}", json={"content": "수정"}, headers=_auth(banned))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "COMMENT_BANNED"
    assert (await client.delete(f"/api/v1/comments/{c.id}", headers=_auth(banned))).status_code == 204


async def test_normal_user_can_comment(client, maker):
    post = await _post(maker)
    u = await _user(maker, "보통")
    r = await client.post(_list_url(post), json={"content": "글"}, headers=_auth(u))
    assert r.status_code == 201, r.text
    assert r.json()["is_mine"] is True and r.json()["hidden"] is False

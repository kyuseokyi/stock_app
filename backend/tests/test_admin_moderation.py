"""관리자 신고 관리·회원 관리(D8·R2) — 신고 묶음 목록, resolve 3종, 댓글 금지, 닉네임 변경, 회원 목록, 권한 403.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §2·§3
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.terms import TERMS_VERSION
from apps.blog.main import app as blog_app
from shared.database import get_db
from shared.models import Base, BlogComment, BlogPost, Board, CommentReport, User, UserRole
from shared.security import create_access_token

REPORTS = "/api/v1/admin/comment-reports"


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


async def _user(maker, name: str, *, role=UserRole.FREE, nickname: str | None = None) -> User:
    async with maker() as db:
        u = User(email=f"{name}@test.local", nickname=nickname or name, role=role, is_active=True,
                 terms_version=TERMS_VERSION)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


def _auth(u: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=u.id, role=u.role.value)}"}


@pytest.fixture
async def world(maker, client):
    """게시글 1, 작성자 1, 신고자 3, 관리자 1. 댓글 a 는 abuse 2·spam 1, 댓글 b 는 spam 1."""
    async with maker() as db:
        board = Board(name="자유", order_index=0, comments_enabled=True)
        db.add(board)
        await db.commit()
        post = BlogPost(board_id=board.id, title="오늘 시황", content="<p>x</p>")
        db.add(post)
        await db.commit()
        await db.refresh(post)
    author = await _user(maker, "작성자")
    r1, r2, r3 = [await _user(maker, f"신고{i}") for i in range(3)]
    admin = await _user(maker, "관리", role=UserRole.ADMIN)
    async with maker() as db:
        a = BlogComment(post_id=post.id, author_id=author.id, content="나쁜 댓글")
        b = BlogComment(post_id=post.id, author_id=author.id, content="광고 댓글")
        db.add_all([a, b])
        await db.commit()
        await db.refresh(a)
        await db.refresh(b)
    for u, reason in ((r1, "abuse"), (r2, "abuse"), (r3, "spam")):
        r = await client.post(f"/api/v1/comments/{a.id}/reports", json={"reason": reason}, headers=_auth(u))
        assert r.status_code == 201
    r = await client.post(f"/api/v1/comments/{b.id}/reports", json={"reason": "spam"}, headers=_auth(r1))
    assert r.status_code == 201
    return {"post": post, "author": author, "reporters": (r1, r2, r3), "admin": admin, "a": a, "b": b}


# ── 목록 ──────────────────────────────────────────────


async def test_admin_list_grouped(client, world):
    r = await client.get(REPORTS, headers=_auth(world["admin"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["comment_id"] for x in body] == [world["b"].id, world["a"].id]  # 최근 신고순
    a = body[1]
    assert a["content"] == "나쁜 댓글" and a["post_id"] == world["post"].id and a["post_title"] == "오늘 시황"
    assert a["author_id"] == world["author"].id and a["author_nickname"] == "작성자"
    assert a["author_comment_banned"] is False
    assert a["report_count"] == 3 and a["reason_counts"] == {"abuse": 2, "spam": 1}
    assert a["hidden"] is True and a["last_reported_at"]
    assert body[0]["report_count"] == 1 and body[0]["hidden"] is False


async def test_admin_endpoints_forbidden_for_users(client, world):
    user = world["reporters"][0]
    a = world["a"]
    assert (await client.get(REPORTS, headers=_auth(user))).status_code == 403
    r = await client.post(f"{REPORTS}/{a.id}/resolve", json={"action": "delete"}, headers=_auth(user))
    assert r.status_code == 403
    r = await client.patch(f"/api/v1/admin/users/{user.id}/comment-ban", json={"banned": True}, headers=_auth(user))
    assert r.status_code == 403
    r = await client.patch(f"/api/v1/admin/users/{user.id}/nickname", json={"nickname": "x"}, headers=_auth(user))
    assert r.status_code == 403
    assert (await client.get("/api/v1/admin/users", headers=_auth(user))).status_code == 403
    assert (await client.get(REPORTS)).status_code == 401


# ── resolve ───────────────────────────────────────────


async def test_resolve_delete(client, maker, world):
    a = world["a"]
    r = await client.post(f"{REPORTS}/{a.id}/resolve", json={"action": "delete"}, headers=_auth(world["admin"]))
    assert r.status_code == 200 and r.json() == {"ok": True, "action": "delete"}
    async with maker() as db:
        assert await db.get(BlogComment, a.id) is None
    ids = [x["comment_id"] for x in (await client.get(REPORTS, headers=_auth(world["admin"]))).json()]
    assert ids == [world["b"].id]  # 처리 후 목록에서 빠진다


async def test_resolve_dismiss(client, maker, world):
    a, admin = world["a"], world["admin"]
    r = await client.post(f"{REPORTS}/{a.id}/resolve", json={"action": "dismiss"}, headers=_auth(admin))
    assert r.status_code == 200
    async with maker() as db:
        row = await db.get(BlogComment, a.id)
        assert row is not None and row.hidden_at is None
        statuses = (await db.execute(select(CommentReport.status).where(CommentReport.comment_id == a.id))).scalars()
        assert set(statuses) == {"dismissed"}
    pending = [x["comment_id"] for x in (await client.get(REPORTS, headers=_auth(admin))).json()]
    assert pending == [world["b"].id]
    dismissed = (await client.get(REPORTS, params={"status": "dismissed"}, headers=_auth(admin))).json()
    assert [x["comment_id"] for x in dismissed] == [a.id] and dismissed[0]["hidden"] is False
    all_ = (await client.get(REPORTS, params={"status": "all"}, headers=_auth(admin))).json()
    assert {x["comment_id"] for x in all_} == {a.id, world["b"].id}
    # 다시 공개 — 일반 사용자 목록에 원문으로
    anon = (await client.get(f"/api/v1/blogs/{world['post'].id}/comments")).json()
    assert [x["content"] for x in anon] == ["나쁜 댓글", "광고 댓글"]


async def test_resolve_ban_author(client, maker, world):
    a, admin, author = world["a"], world["admin"], world["author"]
    r = await client.post(f"{REPORTS}/{a.id}/resolve", json={"action": "ban_author"}, headers=_auth(admin))
    assert r.status_code == 200
    async with maker() as db:
        assert await db.get(BlogComment, a.id) is None
        assert (await db.get(User, author.id)).comment_banned_at is not None
    item = (await client.get(REPORTS, headers=_auth(admin))).json()[0]
    assert item["comment_id"] == world["b"].id and item["author_comment_banned"] is True
    r = await client.post(f"/api/v1/blogs/{world['post'].id}/comments", json={"content": "또"}, headers=_auth(author))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "COMMENT_BANNED"


async def test_resolve_invalid_and_missing(client, world):
    admin = world["admin"]
    r = await client.post(f"{REPORTS}/{world['a'].id}/resolve", json={"action": "nuke"}, headers=_auth(admin))
    assert r.status_code == 422
    r = await client.post(f"{REPORTS}/9999/resolve", json={"action": "delete"}, headers=_auth(admin))
    assert r.status_code == 404


async def test_status_filter_invalid_422(client, world):
    r = await client.get(REPORTS, params={"status": "bogus"}, headers=_auth(world["admin"]))
    assert r.status_code == 422


# ── 회원: 댓글 금지·닉네임·목록 ───────────────────────


async def test_comment_ban_toggle(client, maker, world):
    admin, author = world["admin"], world["author"]
    url = f"/api/v1/admin/users/{author.id}/comment-ban"
    r = await client.patch(url, json={"banned": True}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["comment_banned"] is True and r.json()["comment_banned_at"]
    first = r.json()["comment_banned_at"]
    r = await client.patch(url, json={"banned": True}, headers=_auth(admin))
    assert r.json()["comment_banned_at"] == first  # 최초 시각 유지
    r = await client.patch(url, json={"banned": False}, headers=_auth(admin))
    assert r.json()["comment_banned"] is False and r.json()["comment_banned_at"] is None
    async with maker() as db:
        assert (await db.get(User, author.id)).comment_banned_at is None


async def test_comment_ban_admin_400_and_404(client, world):
    admin = world["admin"]
    r = await client.patch(f"/api/v1/admin/users/{admin.id}/comment-ban", json={"banned": True}, headers=_auth(admin))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "CANNOT_BAN_ADMIN"
    r = await client.patch("/api/v1/admin/users/9999/comment-ban", json={"banned": True}, headers=_auth(admin))
    assert r.status_code == 404


async def test_admin_set_nickname(client, maker, world):
    admin, author = world["admin"], world["author"]
    url = f"/api/v1/admin/users/{author.id}/nickname"
    r = await client.patch(url, json={"nickname": "  관리자  "}, headers=_auth(admin))  # 금칙어 검사 없음(관리자 판단)
    assert r.status_code == 200, r.text
    assert r.json()["nickname"] == "관리자"
    async with maker() as db:
        assert (await db.get(User, author.id)).nickname == "관리자"
    for bad in ("", "   ", "가" * 21):
        assert (await client.patch(url, json={"nickname": bad}, headers=_auth(admin))).status_code == 422
    r = await client.patch("/api/v1/admin/users/9999/nickname", json={"nickname": "x"}, headers=_auth(admin))
    assert r.status_code == 404


async def test_admin_list_users(client, world):
    admin = world["admin"]
    r = await client.get("/api/v1/admin/users", params={"size": 2}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 5 and body["page"] == 1 and body["size"] == 2 and len(body["items"]) == 2
    assert body["items"][0]["id"] == admin.id  # 최근 가입순
    assert set(body["items"][0].keys()) == {"id", "email", "nickname", "role", "provider", "is_active",
                                            "comment_banned", "comment_banned_at", "created_at"}
    found = (await client.get("/api/v1/admin/users", params={"q": "작성"}, headers=_auth(admin))).json()
    assert found["total"] == 1 and found["items"][0]["id"] == world["author"].id

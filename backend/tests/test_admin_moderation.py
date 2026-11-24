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
from shared.models import AuthProvider, Base, BlogComment, BlogPost, Board, CommentReport, User, UserRole
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
                                            "comment_banned", "comment_banned_at", "market_data_access", "created_at"}
    found = (await client.get("/api/v1/admin/users", params={"q": "작성"}, headers=_auth(admin))).json()
    assert found["total"] == 1 and found["items"][0]["id"] == world["author"].id


# ── 회원: 시세 열람 권한(A안 — 운영자 본인 확인용) ─────


async def test_market_data_access_toggle_and_filter(client, maker, world):
    admin, author = world["admin"], world["author"]
    url = f"/api/v1/admin/users/{author.id}/market-data-access"
    listed = (await client.get("/api/v1/admin/users", headers=_auth(admin))).json()
    assert all(u["market_data_access"] is False for u in listed["items"])  # 기본 false
    r = await client.patch(url, json={"enabled": True}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["market_data_access"] is True
    async with maker() as db:
        assert (await db.get(User, author.id)).market_data_access is True
    only = (await client.get("/api/v1/admin/users", params={"market_data_access": "true"}, headers=_auth(admin))).json()
    assert only["total"] == 1 and only["items"][0]["id"] == author.id
    r = await client.patch(url, json={"enabled": False}, headers=_auth(admin))
    assert r.json()["market_data_access"] is False
    only = (await client.get("/api/v1/admin/users", params={"market_data_access": "true"}, headers=_auth(admin))).json()
    assert only["total"] == 0


async def test_market_data_access_admin_400_404_403(client, world):
    admin, author = world["admin"], world["author"]
    r = await client.patch(f"/api/v1/admin/users/{admin.id}/market-data-access", json={"enabled": False},
                           headers=_auth(admin))
    assert r.status_code == 400 and r.json()["detail"]["code"] == "ADMIN_ALWAYS_ALLOWED"
    r = await client.patch("/api/v1/admin/users/9999/market-data-access", json={"enabled": True}, headers=_auth(admin))
    assert r.status_code == 404
    # 일반 회원은 자기 자신에게도 권한을 줄 수 없다
    r = await client.patch(f"/api/v1/admin/users/{author.id}/market-data-access", json={"enabled": True},
                           headers=_auth(author))
    assert r.status_code == 403


# ── 회원: 회원 번호 검색·로그인 방식 필터 ─────────────


async def _set_provider(maker, user: User, provider: AuthProvider, provider_id: str) -> None:
    async with maker() as db:
        u = await db.get(User, user.id)
        u.provider, u.provider_id = provider, provider_id
        await db.commit()


async def test_admin_list_users_search_by_id(client, world):
    admin, author = world["admin"], world["author"]
    for q in (str(author.id), f"#{author.id}", f" # {author.id} "):
        found = (await client.get("/api/v1/admin/users", params={"q": q}, headers=_auth(admin))).json()
        assert author.id in [u["id"] for u in found["items"]], q
    # 닉네임·이메일 부분 검색은 그대로
    found = (await client.get("/api/v1/admin/users", params={"q": "신고"}, headers=_auth(admin))).json()
    assert found["total"] == 3
    # 범위 밖 큰 숫자 — ID 비교에서 빠져 DB 오류 없이 200(0건)
    r = await client.get("/api/v1/admin/users", params={"q": "9" * 20}, headers=_auth(admin))
    assert r.status_code == 200 and r.json()["total"] == 0
    r = await client.get("/api/v1/admin/users", params={"q": "#"}, headers=_auth(admin))
    assert r.status_code == 200


def test_user_id_from_query():
    from apps.blog.services.moderation import user_id_from_query
    assert user_id_from_query("12") == 12
    assert user_id_from_query("#12") == 12
    assert user_id_from_query(" #12 ") == 12
    for bad in (None, "", "#", "0", "12a", "-3", "１２", "9" * 20, "1.5"):
        assert user_id_from_query(bad) is None, bad


async def test_admin_list_users_provider_filter(client, maker, world):
    admin, author = world["admin"], world["author"]
    r1, r2, _ = world["reporters"]
    await _set_provider(maker, author, AuthProvider.KAKAO, "k-1")
    await _set_provider(maker, r1, AuthProvider.NAVER, "n-1")
    await _set_provider(maker, r2, AuthProvider.KAKAO, "k-2")

    def ids(body):
        return {u["id"] for u in body["items"]}

    kakao = (await client.get("/api/v1/admin/users", params={"provider": "KAKAO"}, headers=_auth(admin))).json()
    assert kakao["total"] == 2 and ids(kakao) == {author.id, r2.id}
    assert all(u["provider"] == "KAKAO" for u in kakao["items"])
    naver = (await client.get("/api/v1/admin/users", params={"provider": "NAVER"}, headers=_auth(admin))).json()
    assert ids(naver) == {r1.id}
    local = (await client.get("/api/v1/admin/users", params={"provider": "LOCAL"}, headers=_auth(admin))).json()
    assert local["total"] == 2 and admin.id in ids(local) and all(u["provider"] is None for u in local["items"])
    # 시세 열람 필터·검색어와 함께(AND)
    r = await client.patch(f"/api/v1/admin/users/{author.id}/market-data-access", json={"enabled": True},
                           headers=_auth(admin))
    assert r.status_code == 200
    both = (await client.get("/api/v1/admin/users", params={"provider": "KAKAO", "market_data_access": "true"},
                             headers=_auth(admin))).json()
    assert ids(both) == {author.id}
    none = (await client.get("/api/v1/admin/users", params={"provider": "NAVER", "market_data_access": "true"},
                             headers=_auth(admin))).json()
    assert none["total"] == 0
    by_id = (await client.get("/api/v1/admin/users", params={"provider": "KAKAO", "q": f"#{r2.id}"},
                              headers=_auth(admin))).json()
    assert ids(by_id) == {r2.id}
    # 모르는 값은 422
    r = await client.get("/api/v1/admin/users", params={"provider": "FACEBOOK"}, headers=_auth(admin))
    assert r.status_code == 422


# ── 회원 역할 변경(FREE ↔ ADMIN) ──────────────────────────────


def _role_url(u: User) -> str:
    return f"/api/v1/admin/users/{u.id}/role"


async def _role_of(maker, user_id: int) -> UserRole:
    async with maker() as db:
        return (await db.get(User, user_id)).role


async def test_role_promote_and_demote(client, maker, world, caplog):
    admin, author = world["admin"], world["author"]
    with caplog.at_level("INFO", logger="blog.admin_moderation"):
        r = await client.patch(_role_url(author), json={"role": "ADMIN"}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "ADMIN" and r.json()["id"] == author.id
    assert await _role_of(maker, author.id) == UserRole.ADMIN
    rec = [m for m in caplog.messages if "회원 역할 변경" in m]
    assert rec and f"target={author.id}" in rec[0] and "FREE->ADMIN" in rec[0]
    assert "@test.local" not in rec[0]  # 이메일은 기록하지 않는다

    # 새 관리자는 기존 토큰(role=FREE 클레임)으로도 바로 관리자 API 를 쓴다 — 판정은 DB 기준
    r = await client.get("/api/v1/admin/users", headers=_auth(author))
    assert r.status_code == 200

    r = await client.patch(_role_url(author), json={"role": "FREE"}, headers=_auth(admin))
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "FREE"
    assert await _role_of(maker, author.id) == UserRole.FREE


async def test_role_demoted_admin_old_token_forbidden(client, maker, world):
    """강등된 관리자가 강등 전에 받은 토큰(role=ADMIN 클레임)으로 관리자 API 를 부르면 403."""
    admin = world["admin"]
    other = await _user(maker, "부관리", role=UserRole.ADMIN)
    old_headers = _auth(other)
    r = await client.patch(_role_url(other), json={"role": "FREE"}, headers=_auth(admin))
    assert r.status_code == 200
    r = await client.get("/api/v1/admin/users", headers=old_headers)
    assert r.status_code == 403


async def test_role_cannot_demote_self(client, maker, world):
    admin = world["admin"]
    await _user(maker, "부관리", role=UserRole.ADMIN)  # 관리자가 2명이어도 자기 강등은 막는다
    r = await client.patch(_role_url(admin), json={"role": "FREE"}, headers=_auth(admin))
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "CANNOT_DEMOTE_SELF", "message": "자기 자신의 관리자 권한은 내릴 수 없어요."}
    assert await _role_of(maker, admin.id) == UserRole.ADMIN


async def test_role_last_admin_409(maker, world):
    """HTTP 로는 요청자 자신이 활성 관리자라 도달할 수 없다 — 두 관리자가 서로를 동시에 내리는 경우를 재현:
    요청자(stale)는 이미 강등돼 DB 에 활성 관리자는 대상 1명뿐."""
    from apps.blog.services import moderation

    target = world["admin"]
    actor = await _user(maker, "부관리", role=UserRole.FREE)  # 먼저 커밋된 강등으로 이미 FREE
    async with maker() as db:
        with pytest.raises(moderation.ModerationError) as ei:
            await moderation.set_role(db, target.id, "FREE", actor)
    assert ei.value.status_code == 409 and ei.value.code == "LAST_ADMIN"
    assert await _role_of(maker, target.id) == UserRole.ADMIN


async def test_role_demoted_actor_cannot_demote_others(maker, world):
    """관리자 3명 중 요청자가 그사이 강등됐다면(동시 요청) 남을 내리지 못한다 — 403."""
    from apps.blog.services import moderation

    target = world["admin"]
    await _user(maker, "관리3", role=UserRole.ADMIN)
    actor = await _user(maker, "부관리", role=UserRole.FREE)
    async with maker() as db:
        with pytest.raises(moderation.ModerationError) as ei:
            await moderation.set_role(db, target.id, "FREE", actor)
    assert ei.value.status_code == 403 and ei.value.code == "ADMIN_REQUIRED"


async def test_role_inactive_promote_409(client, maker, world):
    admin, author = world["admin"], world["author"]
    async with maker() as db:
        (await db.get(User, author.id)).is_active = False
        await db.commit()
    r = await client.patch(_role_url(author), json={"role": "ADMIN"}, headers=_auth(admin))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "USER_INACTIVE"
    assert await _role_of(maker, author.id) == UserRole.FREE


async def test_role_forbidden_invalid_missing_same(client, maker, world):
    admin, author = world["admin"], world["author"]
    r = await client.patch(_role_url(admin), json={"role": "FREE"}, headers=_auth(author))
    assert r.status_code == 403
    for bad in ({"role": "PREMIUM"}, {"role": "admin"}, {}):
        r = await client.patch(_role_url(author), json=bad, headers=_auth(admin))
        assert r.status_code == 422, bad
    r = await client.patch("/api/v1/admin/users/9999/role", json={"role": "ADMIN"}, headers=_auth(admin))
    assert r.status_code == 404
    # 같은 역할이면 그대로 200(자기 자신 ADMIN→ADMIN 포함)
    r = await client.patch(_role_url(author), json={"role": "FREE"}, headers=_auth(admin))
    assert r.status_code == 200 and r.json()["role"] == "FREE"
    r = await client.patch(_role_url(admin), json={"role": "ADMIN"}, headers=_auth(admin))
    assert r.status_code == 200 and r.json()["role"] == "ADMIN"


async def test_role_promote_clears_comment_ban(client, maker, world):
    admin, author = world["admin"], world["author"]
    r = await client.patch(f"/api/v1/admin/users/{author.id}/comment-ban", json={"banned": True}, headers=_auth(admin))
    assert r.status_code == 200 and r.json()["comment_banned"] is True
    r = await client.patch(_role_url(author), json={"role": "ADMIN"}, headers=_auth(admin))
    assert r.status_code == 200
    assert r.json()["role"] == "ADMIN" and r.json()["comment_banned"] is False

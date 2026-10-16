"""플랫폼별 단일 세션(중복 로그인 처리) — 스펙 docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md.

DB 는 sqlite in-memory, Redis 는 fakeredis.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi import Depends, FastAPI
from fakeredis import aioredis as fake_aioredis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.deps import get_redis as auth_get_redis
from apps.auth.main import app as auth_app
from shared import sessions
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole, UserSession
from shared.security import create_access_token, decode_token


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _user(maker, uid: int = 1, role: UserRole = UserRole.FREE) -> User:
    async with maker() as db:
        u = User(id=uid, email=f"u{uid}@t.local", nickname=f"u{uid}", role=role, is_active=True)
        db.add(u)
        await db.commit()
        return u


def test_token_without_session_has_no_sid_claims():
    p = decode_token(create_access_token(subject=1, role="FREE"))
    assert "sid" not in p and "plt" not in p


def test_token_with_session_carries_sid_and_platform():
    p = decode_token(create_access_token(subject=1, role="FREE", sid="abc", platform="web"))
    assert p["sid"] == "abc" and p["plt"] == "web"


async def test_user_session_row_roundtrip(maker):
    await _user(maker)
    async with maker() as db:
        db.add(UserSession(user_id=1, platform="web", sid="s1"))
        await db.commit()
        row = await db.get(UserSession, (1, "web"))
    assert row is not None and row.sid == "s1"


async def test_start_session_replaces_sid_per_platform(maker):
    await _user(maker)
    async with maker() as db:
        s1 = await sessions.start_session(db, 1, "web")
        s2 = await sessions.start_session(db, 1, "web")
        a1 = await sessions.start_session(db, 1, "app")
    assert s1 != s2
    async with maker() as db:
        assert (await db.get(UserSession, (1, "web"))).sid == s2
        assert (await db.get(UserSession, (1, "app"))).sid == a1


@pytest.mark.parametrize(
    "payload, stored, ok",
    [
        ({"sub": "1"}, None, True),                                   # 레거시 토큰(sid 없음) 허용
        ({"sub": "1", "sid": "x", "plt": "web"}, None, False),        # 행 없음 → 거부
        ({"sub": "1", "sid": "x", "plt": "web"}, "y", False),         # sid 다름 → 거부
        ({"sub": "1", "sid": "x", "plt": "web"}, "x", True),          # 일치 → 허용
        ({"sub": "1", "sid": "x"}, "x", False),                       # plt 누락 sid 토큰 → 거부
    ],
)
async def test_check_session_rules(maker, payload, stored, ok):
    await _user(maker)
    if stored is not None:
        async with maker() as db:
            db.add(UserSession(user_id=1, platform="web", sid=stored))
            await db.commit()
    async with maker() as db:
        assert await sessions.check_session(db, 1, payload) is ok


async def test_publish_session_replaced_sends_new_sid():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    ps = r.pubsub()
    await ps.subscribe(sessions.SESSION_REPLACED_CHANNEL)
    await ps.get_message(timeout=1)  # subscribe 확인 메시지
    await sessions.publish_session_replaced(r, 1, "web", "new-sid")
    msg = await ps.get_message(ignore_subscribe_messages=True, timeout=1)
    assert json.loads(msg["data"]) == {"user_id": 1, "platform": "web", "sid": "new-sid"}


async def test_publish_failure_is_swallowed():
    class Broken:
        async def publish(self, *_a):
            raise ConnectionError("down")

    await sessions.publish_session_replaced(Broken(), 1, "web", "s")  # 예외 없이 끝나야 함


@pytest.fixture
async def me_client(maker):
    """get_current_user 만 거치는 최소 앱 — GET /whoami."""
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user: User = Depends(get_current_user)):
        return {"id": user.id}

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_relogin_same_platform_rejects_old_token(maker, me_client):
    await _user(maker)
    async with maker() as db:
        old = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "web"), platform="web")
        new = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "web"), platform="web")
    r_old = await me_client.get("/whoami", headers=_bearer(old))
    assert r_old.status_code == 401
    assert r_old.json()["detail"]["code"] == "SESSION_REPLACED"
    assert (await me_client.get("/whoami", headers=_bearer(new))).status_code == 200


async def test_other_platform_token_stays_valid(maker, me_client):
    await _user(maker)
    async with maker() as db:
        app_tok = create_access_token(subject=1, role="FREE", sid=await sessions.start_session(db, 1, "app"), platform="app")
        await sessions.start_session(db, 1, "web")
    assert (await me_client.get("/whoami", headers=_bearer(app_tok))).status_code == 200


async def test_legacy_token_without_sid_is_allowed(maker, me_client):
    await _user(maker)
    legacy = create_access_token(subject=1, role="FREE")
    assert (await me_client.get("/whoami", headers=_bearer(legacy))).status_code == 200


@pytest.fixture
async def auth_ctx(maker, monkeypatch):
    """auth 앱 + 공유 fakeredis(발행 확인용). 게스트 게이트는 켠다."""
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def _db():
        async with maker() as s:
            yield s

    auth_app.dependency_overrides[get_db] = _db
    auth_app.dependency_overrides[auth_get_redis] = lambda: redis
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=auth_app), base_url="http://t") as c:
        yield c, redis
    auth_app.dependency_overrides.clear()


async def test_guest_default_platform_is_web(auth_ctx):
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["plt"] == "web"


async def test_guest_app_platform_and_relogin_publishes(auth_ctx):
    c, redis = auth_ctx
    ps = redis.pubsub()
    await ps.subscribe(sessions.SESSION_REPLACED_CHANNEL)
    await ps.get_message(timeout=1)
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이", "platform": "app"})
    p = decode_token(r.json()["access_token"])
    assert p["plt"] == "app"
    msg = await ps.get_message(ignore_subscribe_messages=True, timeout=1)
    assert json.loads(msg["data"])["sid"] == p["sid"]


async def test_guest_rejects_admin_platform(auth_ctx):
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/guest", json={"nickname": "x", "platform": "admin"})
    assert r.status_code == 422


async def test_admin_login_uses_admin_platform(maker, auth_ctx):
    from shared.security import hash_password

    async with maker() as db:
        db.add(User(email="admin@stock.app", nickname="관리자", role=UserRole.ADMIN, is_active=True,
                    password_hash=hash_password("pw1234")))
        await db.commit()
    c, _ = auth_ctx
    r = await c.post("/api/v1/auth/login", json={"email": "admin@stock.app", "password": "pw1234"})
    assert r.status_code == 200
    assert decode_token(r.json()["access_token"])["plt"] == "admin"


async def test_login_succeeds_when_redis_publish_fails(auth_ctx):
    class Broken:
        async def publish(self, *_a):
            raise ConnectionError("down")

    c, _ = auth_ctx
    auth_app.dependency_overrides[auth_get_redis] = lambda: Broken()
    r = await c.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200

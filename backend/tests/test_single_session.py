"""플랫폼별 단일 세션(중복 로그인 처리) — 스펙 docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md.

DB 는 sqlite in-memory, Redis 는 fakeredis.
"""
from __future__ import annotations

import json

import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared import sessions
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

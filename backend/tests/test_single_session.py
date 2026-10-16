"""플랫폼별 단일 세션(중복 로그인 처리) — 스펙 docs/superpowers/specs/2026-10-16-single-session-per-platform-design.md.

DB 는 sqlite in-memory, Redis 는 fakeredis.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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

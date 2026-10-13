"""퀴즈·아카데미 문항 관리자 편집(백로그 ⑤-2) 테스트 — sqlite + 목(실 CH·DB 미사용)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole
from shared.game_models import AcademyQuestion, ChartQuiz, UserQuizAttempt
from apps.trading_game.main import app


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


@pytest.fixture
async def api(maker):
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, (lambda u: state.__setitem__("user", u))
    app.dependency_overrides.clear()


async def _seed_user(db, role: UserRole = UserRole.FREE, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=role, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ---------------------------------------------------------------- models
async def test_academy_question_roundtrip_defaults(session):
    q = AcademyQuestion(question="질문?", choices=["가", "나"], answer=1, explanation="해설", sort_order=2)
    session.add(q)
    await session.commit()
    await session.refresh(q)
    assert q.id is not None and q.choices == ["가", "나"] and q.is_active is True
    assert q.created_at is not None and q.updated_at is not None


async def test_chart_quiz_is_active_default_true(session):
    q = ChartQuiz(
        ticker="005930", base_date=date(2026, 1, 1), pattern_type="정배열", chart_snapshot=[],
        answer="UP", actual_change=Decimal("1.50"), explanation="-",
    )
    session.add(q)
    await session.commit()
    await session.refresh(q)
    assert q.is_active is True

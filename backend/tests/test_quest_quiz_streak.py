"""트레이딩 게임 Phase 5b — 퀘스트·아카데미·야간 퀴즈·Streak·기능 플래그 테스트."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole
from shared.game_models import (
    ChartQuiz, GameAccount, GameFeatureFlag, GameSeason, UserAcademy, UserBadge,
    UserQuestProgress, UserQuizAttempt, UserStreak,
)
from apps.trading_game import deps
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
def fake_redis(monkeypatch):
    """deps.get_redis 를 fakeredis 로 교체(라우터·서비스 공용)."""
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(deps, "get_redis", lambda: redis)
    return redis


@pytest.fixture
async def api(maker):
    """(client, set_user) — get_db 는 테스트 엔진, 인증 유저는 set_user 로 교체."""
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


async def _seed_season(db, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def _seed_user(db, *, role: UserRole = UserRole.FREE, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=role, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _seed_account(db, user, season, *, cash=Decimal("10000000"), roi=Decimal("0")) -> GameAccount:
    acc = GameAccount(
        user_id=user.id, season_id=season.id, cash_balance=cash, total_asset=cash, current_roi=roi,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc


# ---------------------------------------------------------------- models
async def test_phase5b_tables_roundtrip(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    session.add(acc)
    quiz = ChartQuiz(
        ticker="005930", base_date=date(2026, 9, 1), pattern_type="골든크로스",
        chart_snapshot=[{"date": "2026-09-01", "open": 1.0, "high": 2.0, "low": 1.0, "close": 2.0, "volume": 10}],
        answer="UP", actual_change=Decimal("3.25"), explanation="해설",
    )
    session.add_all([
        quiz,
        UserQuestProgress(user_id=user.id, quest_code="Q1_STOP_LOSS"),
        UserBadge(user_id=user.id, badge_code="PRINCIPLED"),
        UserAcademy(user_id=user.id),
        UserStreak(user_id=user.id),
        GameFeatureFlag(key="QUIZ", enabled=True),
    ])
    await session.commit()
    session.add(UserQuizAttempt(user_id=user.id, quiz_id=quiz.id, served_at=datetime.now(timezone.utc)))
    await session.commit()

    await session.refresh(acc)
    assert acc.bonus_cash == Decimal("0")
    assert quiz.reward_cash == 200000
    ua = await session.get(UserAcademy, user.id)
    assert ua.unlocked_leverage_5x is False and ua.attempts == 0 and ua.passed_at is None
    st = await session.get(UserStreak, user.id)
    assert st.current_streak == 0 and st.highest_streak == 0 and st.last_activity_date is None
    qp = await session.get(UserQuestProgress, (user.id, "Q1_STOP_LOSS"))
    assert qp.progress == 0 and qp.completed_at is None and qp.claimed_at is None
    att = await session.get(UserQuizAttempt, (user.id, quiz.id))
    assert att.rewarded is False and att.reward_date is None and att.submitted_at is None


async def test_quiz_unique_ticker_base_date(session):
    for _ in range(2):
        session.add(ChartQuiz(
            ticker="005930", base_date=date(2026, 9, 1), pattern_type="정배열",
            chart_snapshot=[], answer="UP", actual_change=Decimal("2"), explanation="x",
        ))
    with pytest.raises(IntegrityError):
        await session.commit()

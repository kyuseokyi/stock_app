"""트레이딩 게임 Phase 5a — 데일리 코치 + 스마트 넛지 테스트."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameCoachMessage, GameSeason


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


async def _seed_season(db, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def test_coach_message_draft_has_null_published_at(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="MORNING",
        title="t", summary_nudge="s", content_md="c", status="DRAFT", published_at=None,
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "DRAFT"
    assert msg.published_at is None


async def test_coach_message_status_defaults_to_published(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="EVENING",
        title="t", summary_nudge="s", content_md="c",
        published_at=datetime(2026, 10, 13, 11, 0, tzinfo=timezone.utc),
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "PUBLISHED"


# ---------------------------------------------------------------- nudge engine
from apps.trading_game.services import nudge_engine


def _codes(nudges):
    return [n.code for n in nudges]


@pytest.mark.parametrize("rsi, expected", [(79.99, []), (80.0, ["OVERBOUGHT_CHASE"]), (None, [])])
def test_open_overbought_threshold(rsi, expected):
    assert _codes(nudge_engine.nudges_for_open(side="LONG", ratio=0.25, leverage=1, rsi=rsi)) == expected


def test_open_short_never_overbought_warning():
    assert nudge_engine.nudges_for_open(side="SHORT", ratio=0.25, leverage=1, rsi=95.0) == []


@pytest.mark.parametrize("ratio, leverage, expected", [
    (1.0, 5, ["OVERLEVERAGE"]),
    (1.0, 2, []),
    (0.5, 5, []),
])
def test_open_overleverage(ratio, leverage, expected):
    assert _codes(nudge_engine.nudges_for_open(side="SHORT", ratio=ratio, leverage=leverage, rsi=None)) == expected


def test_open_warning_and_advice_together_in_order():
    nudges = nudge_engine.nudges_for_open(side="LONG", ratio=1.0, leverage=5, rsi=85.0)
    assert _codes(nudges) == ["OVERBOUGHT_CHASE", "OVERLEVERAGE"]
    assert [n.type for n in nudges] == ["WARNING", "ADVICE"]


@pytest.mark.parametrize("reason, roi, expected", [
    ("STOP_LOSS", Decimal("-0.99"), []),
    ("STOP_LOSS", Decimal("-1"), ["PRINCIPLED_STOP"]),
    ("MANUAL", Decimal("-2.5"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3.01"), []),
    ("TAKE_PROFIT", Decimal("-2"), []),
    ("MARGIN_CALL", Decimal("-2"), []),
])
def test_close_principled_stop(reason, roi, expected):
    assert _codes(nudge_engine.nudges_for_close(closed_reason=reason, roi_pct=roi)) == expected


def test_nudge_to_dict_shape():
    n = nudge_engine.nudges_for_close(closed_reason="MANUAL", roi_pct=Decimal("-2"))[0]
    assert n.to_dict() == {"type": "PRAISE", "code": "PRINCIPLED_STOP", "message": n.message}
    assert n.message.startswith("💡")

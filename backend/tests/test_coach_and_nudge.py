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


# ---------------------------------------------------------------- RSI
import json

from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import rsi_service

# StockCharts "RSI" 예제 종가. 시트는 중간값 반올림으로 70.53/66.32 를 표기하지만,
# 반올림 없는 Wilder 계산의 정밀값은 70.4641 / 66.2496 이다.
_SC_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
              45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]


def test_wilder_rsi_hand_computed_period2():
    # 변화 +1,+1 → 시드 gain 1 / loss 0; -1 → 0.5/0.5; +1 → 0.75/0.25 → RS 3 → 75
    assert rsi_service.wilder_rsi([1, 2, 3, 2, 3], period=2) == pytest.approx(75.0)


def test_wilder_rsi_stockcharts_vector():
    assert rsi_service.wilder_rsi(_SC_CLOSES) == pytest.approx(70.4641, abs=1e-3)
    assert rsi_service.wilder_rsi(_SC_CLOSES + [46.00]) == pytest.approx(66.2496, abs=1e-3)


def test_wilder_rsi_all_gains_is_100_and_short_input_none():
    assert rsi_service.wilder_rsi([float(i) for i in range(1, 17)]) == 100.0
    assert rsi_service.wilder_rsi([1.0] * 14) is None  # period+1 미만


async def test_current_rsi_caches_closes_per_day():
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    calls = []

    async def provider(ticker, today):
        calls.append((ticker, today))
        return _SC_CLOSES[:-1]  # 14개 + live 1개 = 15개

    today = date(2026, 10, 13)
    v1 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    v2 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    assert v1 == pytest.approx(70.4641, abs=1e-3)
    assert v2 == v1
    assert len(calls) == 1  # 두 번째는 캐시 적중
    cached = await redis.get("game:rsi:closes:005930:20261013")
    assert json.loads(cached) == _SC_CLOSES[:-1]
    assert await redis.ttl("game:rsi:closes:005930:20261013") > 0


async def test_current_rsi_returns_none_on_provider_error_and_does_not_cache_empty():
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def boom(ticker, today):
        raise RuntimeError("clickhouse down")

    async def empty(ticker, today):
        return []

    today = date(2026, 10, 13)
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=boom) is None
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=empty) is None
    assert await redis.get("game:rsi:closes:005930:20261013") is None


def test_fetch_closes_excludes_today(monkeypatch):
    from types import SimpleNamespace
    from apps.stock_api.services import clickhouse_source

    rows = [SimpleNamespace(date="2026-10-10", close=1.0),
            SimpleNamespace(date="2026-10-12", close=2.0),
            SimpleNamespace(date="2026-10-13", close=3.0)]  # 오늘 행은 제외되어야 함
    monkeypatch.setattr(clickhouse_source, "get_candles", lambda s, a, b: rows)
    assert rsi_service._fetch_closes_from_clickhouse("005930", date(2026, 10, 13)) == [1.0, 2.0]

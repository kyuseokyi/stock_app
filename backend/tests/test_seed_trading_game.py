"""시즌 시드 — 이번 달 1일 09:00 ~ 말일 20:00(KST) 월간 시즌, 무기한 시즌 종료일 보정."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base
from shared.game_models import GameSeason

KST = timezone(timedelta(hours=9))


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


def _kst(dt: datetime) -> datetime:
    # sqlite 는 aware datetime 의 tz 를 버리고 입력 벽시계(KST)를 그대로 저장한다 → naive 는 KST 로 해석.
    # (PostgreSQL timestamptz 는 정확히 보존되므로 운영과 무관한 테스트 보정)
    return (dt if dt.tzinfo else dt.replace(tzinfo=KST)).astimezone(KST)


def test_month_bounds_same_month_and_leap():
    from apps.trading_game.services.settlement import month_bounds

    s, e = month_bounds(datetime(2026, 10, 13, 21, 0, tzinfo=KST))
    assert s == datetime(2026, 10, 1, 9, 0, tzinfo=KST)
    assert e == datetime(2026, 10, 31, 20, 0, tzinfo=KST)
    _, e2 = month_bounds(datetime(2028, 2, 10, tzinfo=KST))
    assert e2 == datetime(2028, 2, 29, 20, 0, tzinfo=KST)


async def test_seed_creates_monthly_season(session):
    from scripts.seed_trading_game import seed_in

    now = datetime(2026, 10, 13, 21, 0, tzinfo=KST)
    result = await seed_in(session, now=now)
    season = (await session.execute(select(GameSeason))).scalar_one()
    assert result["season_created"] is True
    assert _kst(season.start_at) == datetime(2026, 10, 1, 9, 0, tzinfo=KST)
    assert _kst(season.end_at) == datetime(2026, 10, 31, 20, 0, tzinfo=KST)


async def test_seed_backfills_open_ended_active_season(session):
    from scripts.seed_trading_game import seed_in

    session.add(GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=KST), end_at=None, status="ACTIVE",
    ))
    await session.commit()
    result = await seed_in(session, now=datetime(2026, 10, 13, 21, 0, tzinfo=KST))
    season = (await session.execute(select(GameSeason))).scalar_one()
    assert result["season_created"] is False
    assert result["end_at_backfilled"] is True
    assert _kst(season.end_at) == datetime(2026, 10, 31, 20, 0, tzinfo=KST)

    again = await seed_in(session, now=datetime(2026, 10, 14, 9, 0, tzinfo=KST))
    assert again["end_at_backfilled"] is False  # 멱등

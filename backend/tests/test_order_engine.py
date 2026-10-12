"""트레이딩 게임 Phase 3 — 주문/체결 엔진 단위 테스트.

순수 수식(pricing)은 IO 없이 검증하고, 서비스 계층은 self-contained aiosqlite
인메모리 세션(tests/test_game_models.py 패턴)으로 검증한다.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.trading_game.services import pricing
from shared.models import Base, User, UserRole
from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade, INITIAL_CASH


def test_roi_long_no_leverage():
    # +10% 상승, 1x → 10% - 0.03% 수수료
    roi = pricing.compute_roi_pct("LONG", Decimal("100"), Decimal("110"), 1)
    assert roi == Decimal("9.97")


def test_roi_long_5x():
    # +10% 상승, 5x → 50% - 0.03%
    roi = pricing.compute_roi_pct("LONG", Decimal("100"), Decimal("110"), 5)
    assert roi == Decimal("49.97")


def test_roi_short_profit_on_drop():
    # SHORT 는 하락 시 이익: -10% 하락, 2x → 20% - 0.03%
    roi = pricing.compute_roi_pct("SHORT", Decimal("100"), Decimal("90"), 2)
    assert roi == Decimal("19.97")


def test_pnl_from_roi():
    pnl = pricing.compute_pnl(Decimal("1000000"), Decimal("9.97"))
    assert pnl == Decimal("99700.00")


def test_tp_sl_prices_long():
    sl, tp = pricing.tp_sl_prices("LONG", Decimal("100"), Decimal("0.05"), Decimal("0.10"))
    assert sl == Decimal("95.00")
    assert tp == Decimal("110.00")


def test_tp_sl_prices_short():
    sl, tp = pricing.tp_sl_prices("SHORT", Decimal("100"), Decimal("0.05"), Decimal("0.10"))
    assert sl == Decimal("105.00")
    assert tp == Decimal("90.00")


def test_tp_sl_prices_none_when_pct_missing():
    sl, tp = pricing.tp_sl_prices("LONG", Decimal("100"), None, None)
    assert sl is None and tp is None


def test_liquidation_take_profit_long():
    # TP=110 도달
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("110"), 1, Decimal("95"), Decimal("110")
    )
    assert reason == "TAKE_PROFIT"


def test_liquidation_stop_loss_long():
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("95"), 1, Decimal("95"), Decimal("110")
    )
    assert reason == "STOP_LOSS"


def test_liquidation_none_when_untriggered():
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("101"), 1, Decimal("95"), Decimal("110")
    )
    assert reason is None


def test_roi_loss_side_with_fee():
    # LONG -10% 하락, 1x → -10% - 0.03% = -10.03%
    roi = pricing.compute_roi_pct("LONG", Decimal("100"), Decimal("90"), 1)
    assert roi == Decimal("-10.03")


def test_liquidation_short_stop_loss():
    # SHORT: cur >= sl 면 손절
    reason = pricing.liquidation_reason(
        "SHORT", Decimal("100"), Decimal("105"), 1, Decimal("105"), Decimal("90")
    )
    assert reason == "STOP_LOSS"


def test_liquidation_short_take_profit():
    # SHORT: cur <= tp 면 익절
    reason = pricing.liquidation_reason(
        "SHORT", Decimal("100"), Decimal("90"), 1, Decimal("105"), Decimal("90")
    )
    assert reason == "TAKE_PROFIT"


def test_liquidation_margin_call_boundary():
    # roi == -80 경계: 16% 하락 × 5x = -80% → -80.03%(수수료 포함) ≤ -80 → 마진콜
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("84"), 5, None, None
    )
    assert reason == "MARGIN_CALL"


def test_liquidation_margin_call_beats_stop_loss():
    # SL(95) 도 맞았지만 ROI ≤ -80 이면 MARGIN_CALL 우선
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("80"), 5, Decimal("95"), Decimal("110")
    )
    assert reason == "MARGIN_CALL"


def test_tp_sl_rejects_negative_fraction():
    import pytest
    with pytest.raises(ValueError):
        pricing.tp_sl_prices("LONG", Decimal("100"), Decimal("-0.05"), None)


def test_roi_rejects_bad_side_and_zero_entry():
    import pytest
    with pytest.raises(ValueError):
        pricing.compute_roi_pct("long", Decimal("100"), Decimal("110"), 1)
    with pytest.raises(ValueError):
        pricing.compute_roi_pct("LONG", Decimal("0"), Decimal("110"), 1)


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed_account(session) -> GameAccount:
    user = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc), status="ACTIVE",
    )
    session.add_all([user, season])
    await session.commit()
    await session.refresh(user)
    await session.refresh(season)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return acc


def _position(acc: GameAccount, **over) -> GamePosition:
    kw = dict(
        account_id=acc.id, side="LONG", entry_price=Decimal("100"),
        size_amount=Decimal("1000000"), entry_ratio=Decimal("0.1"), leverage=1, status="OPEN",
    )
    kw.update(over)
    return GamePosition(**kw)


async def test_single_open_position_constraint(session):
    acc = await _seed_account(session)
    session.add(_position(acc))
    await session.commit()
    session.add(_position(acc))  # 두 번째 OPEN → 부분 유니크 위반
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_second_open_allowed_after_close(session):
    acc = await _seed_account(session)
    p1 = _position(acc)
    session.add(p1)
    await session.commit()
    p1.status = "CLOSED"
    await session.commit()
    session.add(_position(acc))  # 이전 것이 CLOSED 라 허용
    await session.commit()

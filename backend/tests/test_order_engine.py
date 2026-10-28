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


@pytest.mark.parametrize("side, entry, exit_, expected", [
    ("LONG", "100", "101", "MANUAL_TP"),
    ("LONG", "100", "99", "MANUAL_SL"),
    ("LONG", "100", "100", "MANUAL_SL"),   # 본전은 손절로 본다
    ("SHORT", "100", "99", "MANUAL_TP"),
    ("SHORT", "100", "101", "MANUAL_SL"),
    ("SHORT", "100", "100", "MANUAL_SL"),
])
def test_manual_close_reason(side, entry, exit_, expected):
    assert pricing.manual_close_reason(side, Decimal(entry), Decimal(exit_)) == expected


def test_manual_close_reason_rejects_bad_side():
    with pytest.raises(ValueError):
        pricing.manual_close_reason("UP", Decimal("100"), Decimal("101"))


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


from datetime import time as dtime
from apps.trading_game.services import market_clock


def test_parse_windows_default():
    w = market_clock.parse_windows(None)
    assert w == [(dtime(9, 0), dtime(15, 30)), (dtime(16, 0), dtime(20, 0))]


def test_parse_windows_custom():
    w = market_clock.parse_windows("09:00-12:00,13:00-15:00")
    assert w == [(dtime(9, 0), dtime(12, 0)), (dtime(13, 0), dtime(15, 0))]


def test_in_window_regular_session():
    now = datetime(2026, 10, 12, 10, 30, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is True


def test_in_window_excludes_premarket():
    now = datetime(2026, 10, 12, 8, 30, tzinfo=market_clock.KST)  # NXT 프리마켓
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is False


def test_in_window_aftermarket():
    now = datetime(2026, 10, 12, 18, 0, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is True


def test_in_window_night_closed():
    now = datetime(2026, 10, 12, 21, 0, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is False


def test_price_fresh():
    assert market_clock.is_price_fresh(1000.0, 1005.0, 10) is True
    assert market_clock.is_price_fresh(1000.0, 1015.0, 10) is False


from apps.trading_game.services import account_service, order_engine


async def test_get_or_create_account_grants_initial_cash(session):
    acc = await _seed_account(session)
    got = await account_service.get_or_create_account(session, acc.user_id, acc.season_id)
    assert got.id == acc.id
    assert got.cash_balance == INITIAL_CASH


async def test_open_position_deducts_cash_and_sets_tp_sl(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"),
        leverage=2, entry_price=Decimal("100"),
        sl_pct=Decimal("0.05"), tp_pct=Decimal("0.10"),
    )
    assert pos.size_amount == INITIAL_CASH * Decimal("0.5")
    assert pos.stop_loss_price == Decimal("95.00")
    assert pos.take_profit_price == Decimal("110.00")
    await session.refresh(acc)
    assert acc.cash_balance == INITIAL_CASH - pos.size_amount


async def test_open_position_rejects_below_minimum(session):
    acc = await _seed_account(session)
    # 잔고를 30만으로 낮춰 ratio 0.25 진입 시 size=75,000 < 최소 10만 → 거부 유도
    acc.cash_balance = Decimal("300000")
    await session.commit()
    with pytest.raises(order_engine.OrderError):
        await order_engine.open_position(
            session, account=acc, side="LONG", ratio=Decimal("0.25"),
            leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )  # 300,000 × 0.25 = 75,000 < 100,000 최소


async def test_close_position_returns_principal_plus_pnl(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL"
    )
    assert trade is not None
    assert trade.closed_reason == "MANUAL"
    assert trade.roi_pct == Decimal("9.97")  # +10% - 0.03
    await session.refresh(acc)
    assert acc.total_trades == 1
    assert acc.win_trades == 1  # pnl > 0


async def test_close_position_idempotent_on_already_closed(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    first = await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL")
    second = await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("120"), reason="MANUAL")
    assert first is not None
    assert second is None  # 이미 CLOSED → no-op
    await session.refresh(acc)
    assert acc.total_trades == 1


async def test_close_position_restores_cash(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL"
    )
    await session.refresh(acc)
    assert acc.cash_balance == INITIAL_CASH + trade.pnl_amount
    assert trade.pnl_amount == (INITIAL_CASH * Decimal("9.97") / Decimal("100")).quantize(Decimal("0.01"))


async def test_close_losing_position(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("90"), reason="STOP_LOSS"
    )
    assert trade.pnl_amount < 0
    await session.refresh(acc)
    assert acc.win_trades == 0
    assert acc.total_trades == 1
    assert acc.cash_balance == INITIAL_CASH + trade.pnl_amount


async def test_close_short_position_profit_on_drop(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="SHORT", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("90"), reason="MANUAL"
    )
    assert trade.side == "SHORT"
    assert trade.roi_pct == Decimal("9.97")
    await session.refresh(acc)
    assert acc.win_trades == 1


async def test_close_margin_call_clamps_to_principal(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=5, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    # -30% × 5x = -150% → 원금 초과 손실 → 클램프
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("70"), reason="MARGIN_CALL"
    )
    assert trade.pnl_amount == -pos.size_amount
    await session.refresh(acc)
    assert acc.cash_balance == Decimal("0.00")


async def test_close_nonexistent_position_returns_none(session):
    await _seed_account(session)
    result = await order_engine.close_position(
        session, position_id=uuid.uuid4(), exit_price=Decimal("100"), reason="MANUAL"
    )
    assert result is None


async def test_close_snapshots_trade_fields(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"),
        leverage=2, entry_price=Decimal("100"), sl_pct=Decimal("0.05"), tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL"
    )
    assert trade.size_amount == pos.size_amount
    assert trade.leverage == 2
    assert trade.entry_ratio == Decimal("0.5000")
    assert trade.had_stop_loss is True
    assert trade.opened_at is not None
    closed = await session.get(GamePosition, pos.id)
    assert closed.status == "CLOSED"


async def test_second_open_raises_already_open(session):
    acc = await _seed_account(session)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.25"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    with pytest.raises(order_engine.OrderError) as ei:
        await order_engine.open_position(
            session, account=acc, side="LONG", ratio=Decimal("0.25"),
            leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )
    assert ei.value.code == "ALREADY_OPEN"


def test_season_is_tradable_variants():
    base = dict(
        season_number=1, ticker="005930", stock_name="삼성",
        start_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
    )
    assert account_service.season_is_tradable(GameSeason(**base, status="ACTIVE", end_at=None)) is True
    assert account_service.season_is_tradable(
        GameSeason(**base, status="ACTIVE", end_at=datetime(2999, 1, 1, tzinfo=timezone.utc))
    ) is True
    assert account_service.season_is_tradable(
        GameSeason(**base, status="ACTIVE", end_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
    ) is False
    assert account_service.season_is_tradable(GameSeason(**base, status="FINISHED", end_at=None)) is False


from apps.trading_game.services import liquidation_service


async def test_check_and_liquidate_triggers_take_profit(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=Decimal("0.10"),
    )
    # TP=110 도달 → 자동청산
    trades = await liquidation_service.check_and_liquidate(session, "005930", Decimal("110"))
    assert len(trades) == 1
    assert trades[0].closed_reason == "TAKE_PROFIT"
    closed = await session.get(GamePosition, pos.id)
    assert closed.status == "CLOSED"


async def test_check_and_liquidate_skips_untriggered(session):
    acc = await _seed_account(session)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=Decimal("0.05"), tp_pct=Decimal("0.10"),
    )
    trades = await liquidation_service.check_and_liquidate(session, "005930", Decimal("101"))
    assert trades == []


async def test_check_and_liquidate_other_ticker_untouched(session):
    acc = await _seed_account(session)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=Decimal("0.10"),
    )
    # 시즌 종목은 005930 이므로 다른 종목 틱으로는 청산 안 됨
    trades = await liquidation_service.check_and_liquidate(session, "000660", Decimal("110"))
    assert trades == []


from apps.trading_game.services.connection_manager import sentiment_from_counts


def test_sentiment_ratio():
    s = sentiment_from_counts(long_count=65, short_count=35)
    assert s == {"long_pct": 65.0, "short_pct": 35.0, "total": 100}


def test_sentiment_zero_positions():
    s = sentiment_from_counts(long_count=0, short_count=0)
    assert s == {"long_pct": 0.0, "short_pct": 0.0, "total": 0}


def test_sentiment_total_is_long_plus_short():
    assert sentiment_from_counts(long_count=2, short_count=1)["total"] == 3


async def test_close_updates_account_aggregates(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL"
    )
    await session.refresh(acc)
    assert acc.total_asset == acc.cash_balance          # 청산 후 총자산=현금
    assert acc.current_roi == Decimal("9.9700")         # +9.97%
    assert acc.max_roi == Decimal("9.9700")


# ---------------------------------------------------------------- 부분 익절 · 원금 회수(2026-10-28 설계)
from apps.trading_game.services import ranking_service, reward_service  # noqa: E402


async def _open_full(session, acc, *, side="LONG", leverage=1):
    """현금 1,000만 원 전액 진입(진입가 100)."""
    return await order_engine.open_position(
        session, account=acc, side=side, ratio=Decimal("1.0"),
        leverage=leverage, entry_price=Decimal("100"), sl_pct=Decimal("0.05"), tp_pct=Decimal("0.2"),
    )


async def test_partial_half_closes_half_and_keeps_position(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    trade, left = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
    )
    assert trade.closed_reason == "PARTIAL_TP"
    assert trade.size_amount == Decimal("5000000.00")
    assert trade.roi_pct == Decimal("9.97")
    assert trade.pnl_amount == Decimal("498500.00")
    assert left.status == "OPEN" and left.size_amount == Decimal("5000000.00")
    # 진입가·레버리지·손절·익절은 그대로
    assert (left.entry_price, left.leverage) == (Decimal("100.00"), 1)
    assert left.stop_loss_price == Decimal("95.00") and left.take_profit_price == Decimal("120.00")
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert acc.cash_balance == Decimal("5498500.00")  # 0 + 500만 + 49.85만
    # 총자산 = 현금 + 남은 원금 + 남은 평가손익 → 부분 청산 전과 같은 평가
    assert acc.total_asset == Decimal("5498500.00") + Decimal("5000000") + Decimal("498500.00")
    assert acc.current_roi == Decimal("9.9700")
    assert acc.current_roi == ranking_service.compute_live_roi(
        acc.cash_balance, left, Decimal("110"), reward_service.principal(acc)
    )
    assert acc.max_roi == Decimal("9.9700")
    assert (acc.total_trades, acc.win_trades) == (0, 0)  # 거래 수는 최종 청산 때만


async def test_partial_principal_returns_principal_and_keeps_profit(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    size = pos.size_amount
    trade, left = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="principal"
    )
    assert trade.closed_reason == "PRINCIPAL_OUT"
    returned = trade.size_amount + trade.pnl_amount
    assert abs(returned - size) <= Decimal("0.02")  # 돌려받는 돈 = 지금 원금(반올림 오차 이내)
    assert trade.size_amount + left.size_amount == size  # 남는 원금은 따로 반올림하지 않음
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert acc.cash_balance == returned
    # 남은 포지션 평가금(원금+평가손익) ≈ 최초 수익금
    left_value = left.size_amount + pricing.compute_pnl(left.size_amount, Decimal("9.97"))
    full_profit = pricing.compute_pnl(size, Decimal("9.97"))
    assert abs(left_value - full_profit) <= Decimal("0.02")


async def test_partial_remaining_below_min_order_is_allowed(session):
    """남는 원금에는 최소 주문 10만 원 하한을 적용하지 않는다(진입 규칙일 뿐)."""
    acc = await _seed_account(session)
    pos = _position(acc, size_amount=Decimal("150000"))
    session.add(pos)
    await session.commit()
    _, left = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
    )
    assert left.status == "OPEN" and left.size_amount == Decimal("75000.00") < order_engine.MIN_ORDER_AMOUNT


async def test_partial_principal_twice_uses_remaining_size(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    _, left = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="principal"
    )
    first_left = left.size_amount
    trade2, left2 = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="principal"
    )
    assert abs(trade2.size_amount + trade2.pnl_amount - first_left) <= Decimal("0.02")
    assert left2.size_amount == first_left - trade2.size_amount


@pytest.mark.parametrize("exit_price", [Decimal("90"), Decimal("100"), Decimal("100.02")])
async def test_partial_rejected_when_not_in_profit(session, exit_price):
    # 100.02 = 가격은 올랐지만 수수료 뺀 ROI 는 0 이하
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    for portion in ("half", "principal"):
        with pytest.raises(order_engine.OrderError) as e:
            await order_engine.partial_close_position(
                session, position_id=pos.id, exit_price=exit_price, portion=portion
            )
        assert e.value.code == "NOT_IN_PROFIT"
    left = await session.get(GamePosition, pos.id, populate_existing=True)
    assert left.size_amount == Decimal("10000000.00")
    assert (await session.execute(select(GameTrade))).scalars().all() == []


async def test_partial_rejected_when_nothing_left(session):
    acc = await _seed_account(session)
    pos = _position(acc, size_amount=Decimal("0.01"))
    session.add(pos)
    await session.commit()
    with pytest.raises(order_engine.OrderError) as e:
        await order_engine.partial_close_position(
            session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
        )
    assert e.value.code == "NOTHING_LEFT"


async def test_partial_on_closed_position_returns_none(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL_TP")
    assert await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
    ) is None


async def test_full_close_with_stale_size_changes_nothing(session, monkeypatch):
    """읽은 뒤 부분 청산으로 크기가 바뀌면(경쟁) 옛 크기로 전량 청산하지 않는다 — 0행 → None."""
    from sqlalchemy import update

    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    real = order_engine._realized_pnl_of

    async def concurrent_partial(db, position_id):
        # close_position 이 크기를 읽은 '뒤', UPDATE '전'에 다른 요청이 크기를 바꾼 상황
        await db.execute(
            update(GamePosition).where(GamePosition.id == position_id)
            .values(size_amount=Decimal("5000000")).execution_options(synchronize_session=False)
        )
        return await real(db, position_id)

    monkeypatch.setattr(order_engine, "_realized_pnl_of", concurrent_partial)
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="TAKE_PROFIT"
    )
    assert trade is None
    left = await session.get(GamePosition, pos.id, populate_existing=True)
    assert left.status == "OPEN" and left.size_amount == Decimal("5000000.00")
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert acc.cash_balance == Decimal("0.00") and acc.total_trades == 0
    assert (await session.execute(select(GameTrade))).scalars().all() == []


async def test_full_close_after_partial_uses_remaining_size(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL_TP"
    )
    assert trade.size_amount == Decimal("5000000.00")
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert acc.cash_balance == Decimal("10997000.00")  # 전량 한 번에 청산한 것과 같다
    assert acc.total_asset == acc.cash_balance
    assert (acc.total_trades, acc.win_trades) == (1, 1)  # 부분 1 + 최종 1 이어도 거래 수는 1


async def test_final_loss_but_net_profit_counts_as_win(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    half, _ = await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), portion="half"
    )  # +498,500
    final = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("95"), reason="STOP_LOSS"
    )  # 500만 × -5.03% = -251,500
    assert final.pnl_amount < 0 < half.pnl_amount + final.pnl_amount
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert (acc.total_trades, acc.win_trades) == (1, 1)


async def test_final_net_loss_after_partial_counts_as_loss(session):
    acc = await _seed_account(session)
    pos = await _open_full(session, acc)
    await order_engine.partial_close_position(
        session, position_id=pos.id, exit_price=Decimal("101"), portion="half"
    )  # 500만 × 0.97% = +48,500
    await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("95"), reason="STOP_LOSS"
    )  # -251,500
    acc = await session.get(GameAccount, acc.id, populate_existing=True)
    assert (acc.total_trades, acc.win_trades) == (1, 0)

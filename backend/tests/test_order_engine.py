"""트레이딩 게임 Phase 3 — 주문/체결 엔진 단위 테스트.

순수 수식(pricing)은 IO 없이 검증하고, 서비스 계층은 self-contained aiosqlite
인메모리 세션(tests/test_game_models.py 패턴)으로 검증한다.
"""
from __future__ import annotations

from decimal import Decimal

from apps.trading_game.services import pricing


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


def test_liquidation_margin_call_priority():
    # 5x, -20% 하락 → ROI -100% ≤ -80% → SL 미설정이어도 마진콜
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("80"), 5, None, None
    )
    assert reason == "MARGIN_CALL"


def test_liquidation_none_when_untriggered():
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("101"), 1, Decimal("95"), Decimal("110")
    )
    assert reason is None

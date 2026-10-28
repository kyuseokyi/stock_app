"""가상 주문 손익/청산 순수 수식 (IO 의존성 없음).

ROI 단위 = 퍼센트(예: 9.97 = +9.97%). 왕복 수수료 0.03%p 차감.
SL/TP 입력 pct = 분수(0.05 = 5%). 모든 수는 Decimal.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

FEE_ROUNDTRIP_PCT = Decimal("0.03")      # 왕복 수수료 %p (편도 0.015 × 2)
MARGIN_CALL_ROI_PCT = Decimal("-80")     # 수수료 포함·4자리 반올림된 ROI 기준 임계
_PCT_Q = Decimal("0.0001")               # roi_pct Numeric(8,4)
_MONEY_Q = Decimal("0.01")               # 금액 Numeric(15,2)

# 부분 청산 사유(game_trades.closed_reason). 포지션은 OPEN 으로 남아 있는 '거래 일부' 기록 —
# 거래 수·승률·MBTI 처럼 "거래 1건"으로 세는 집계에서는 빼고, 손익 합계에는 포함한다.
PARTIAL_TP = "PARTIAL_TP"          # 절반 익절
PRINCIPAL_OUT = "PRINCIPAL_OUT"    # 원금 회수
PARTIAL_CLOSE_REASONS = frozenset({PARTIAL_TP, PRINCIPAL_OUT})


def compute_roi_pct(side: str, entry: Decimal, cur: Decimal, leverage: int) -> Decimal:
    """방향·레버리지 반영 ROI(%) — 수수료 차감 후, 소수 4자리 반올림."""
    if side not in ("LONG", "SHORT"):
        raise ValueError(f"side must be LONG or SHORT, got {side!r}")
    if entry <= 0:
        raise ValueError(f"entry price must be positive, got {entry}")
    if leverage <= 0:
        raise ValueError(f"leverage must be positive, got {leverage}")
    if side == "LONG":
        move = (cur - entry) / entry
    else:  # SHORT
        move = (entry - cur) / entry
    roi = move * Decimal(leverage) * Decimal("100") - FEE_ROUNDTRIP_PCT
    return roi.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


def compute_pnl(size_amount: Decimal, roi_pct: Decimal) -> Decimal:
    """평가손익 금액 = 원금 × roi% / 100, 2자리 반올림."""
    return (size_amount * roi_pct / Decimal("100")).quantize(_MONEY_Q, rounding=ROUND_HALF_UP)


def tp_sl_prices(
    side: str, entry: Decimal, sl_pct: Decimal | None, tp_pct: Decimal | None
) -> tuple[Decimal | None, Decimal | None]:
    """TP/SL 절대가. pct=분수. LONG/SHORT 방향별 부호."""
    if side not in ("LONG", "SHORT"):
        raise ValueError(f"side must be LONG or SHORT, got {side!r}")
    sl = tp = None
    if sl_pct is not None:
        if sl_pct <= 0:
            raise ValueError(f"stop_loss fraction must be positive, got {sl_pct}")
        sl = entry * (Decimal("1") - sl_pct) if side == "LONG" else entry * (Decimal("1") + sl_pct)
        sl = sl.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)
    if tp_pct is not None:
        if tp_pct <= 0:
            raise ValueError(f"take_profit fraction must be positive, got {tp_pct}")
        tp = entry * (Decimal("1") + tp_pct) if side == "LONG" else entry * (Decimal("1") - tp_pct)
        tp = tp.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)
    return sl, tp


def liquidation_reason(
    side: str,
    entry: Decimal,
    cur: Decimal,
    leverage: int,
    sl_price: Decimal | None,
    tp_price: Decimal | None,
) -> str | None:
    """청산 사유 판정. 우선순위: MARGIN_CALL > STOP_LOSS > TAKE_PROFIT."""
    roi = compute_roi_pct(side, entry, cur, leverage)
    if roi <= MARGIN_CALL_ROI_PCT:
        return "MARGIN_CALL"
    if side == "LONG":
        if sl_price is not None and cur <= sl_price:
            return "STOP_LOSS"
        if tp_price is not None and cur >= tp_price:
            return "TAKE_PROFIT"
    else:  # SHORT
        if sl_price is not None and cur >= sl_price:
            return "STOP_LOSS"
        if tp_price is not None and cur <= tp_price:
            return "TAKE_PROFIT"
    return None



def manual_close_reason(side: str, entry: Decimal, exit_price: Decimal) -> str:
    """수동 청산 사유 — 가격이 유리한 쪽으로 움직였으면 MANUAL_TP, 아니면(본전 포함) MANUAL_SL.

    수수료 때문에 아주 작은 이익이 손실 ROI 가 될 수 있지만, 사용자가 본 '가격 방향'과 맞춘다.
    """
    if side == "LONG":
        return "MANUAL_TP" if exit_price > entry else "MANUAL_SL"
    if side == "SHORT":
        return "MANUAL_TP" if exit_price < entry else "MANUAL_SL"
    raise ValueError(f"side must be LONG or SHORT, got {side!r}")

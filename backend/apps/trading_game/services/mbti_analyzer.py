"""Trading MBTI 분류(순수 함수). 입력: 유저의 청산 내역(GameTrade 유사 객체).

속성 사용: side, pnl_amount(Decimal), entry_ratio(Decimal), had_stop_loss(bool),
opened_at/closed_at(datetime), closed_reason(없으면 최종 청산으로 간주). 거래 <3건이면 기본 라벨.
부분 청산 기록(PARTIAL_TP·PRINCIPAL_OUT)은 '거래 1건'이 아니므로 분류에서 뺀다.
우선순위(첫 매치): 불나방 > 냉철한 원칙주의자 > 빅쇼트의 후예 > 황소 저격수 > 기본.
"""
from __future__ import annotations

from decimal import Decimal

from apps.trading_game.services.pricing import PARTIAL_CLOSE_REASONS

DEFAULT_LABEL = "균형 탐색가"
MIN_TRADES = 3
ALLIN_RATIO = Decimal("1.0")
ALLIN_SHARE_THRESHOLD = 0.5
SCALP_HOLD_SECONDS = 600
STOP_LOSS_THRESHOLD = 0.7
SHORT_PROFIT_SHARE_THRESHOLD = 0.6
LONG_WINRATE_THRESHOLD = 0.6


def classify_mbti(trades: list) -> str:
    trades = [t for t in trades if getattr(t, "closed_reason", None) not in PARTIAL_CLOSE_REASONS]
    n = len(trades)
    if n < MIN_TRADES:
        return DEFAULT_LABEL

    allin = sum(1 for t in trades if t.entry_ratio == ALLIN_RATIO) / n
    avg_hold = sum((t.closed_at - t.opened_at).total_seconds() for t in trades) / n
    if allin >= ALLIN_SHARE_THRESHOLD and avg_hold < SCALP_HOLD_SECONDS:
        return "불나방 트레이더"

    sl_ratio = sum(1 for t in trades if t.had_stop_loss) / n
    if sl_ratio >= STOP_LOSS_THRESHOLD:
        return "냉철한 원칙주의자"

    total_profit = sum((t.pnl_amount for t in trades if t.pnl_amount > 0), Decimal("0"))
    short_profit = sum(
        (t.pnl_amount for t in trades if t.pnl_amount > 0 and t.side == "SHORT"),
        Decimal("0"),
    )
    if total_profit > 0 and short_profit / total_profit >= Decimal(str(SHORT_PROFIT_SHARE_THRESHOLD)):
        return "빅쇼트의 후예"

    longs = [t for t in trades if t.side == "LONG"]
    if longs:
        long_winrate = sum(1 for t in longs if t.pnl_amount > 0) / len(longs)
        if long_winrate >= LONG_WINRATE_THRESHOLD:
            return "황소 저격수"

    return DEFAULT_LABEL

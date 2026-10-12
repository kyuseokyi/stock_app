"""트레이딩 게임 Phase 4 — 랭킹/정산/MBTI 단위 테스트."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from apps.trading_game.services import mbti_analyzer


def _trade(side="LONG", pnl="100", ratio="0.5", had_sl=True, hold_sec=3600):
    """MBTI 분류 입력용 경량 스텁(실제 GameTrade 속성명과 동일)."""
    opened = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    closed = opened + timedelta(seconds=hold_sec)

    class _T:
        pass
    t = _T()
    t.side = side
    t.pnl_amount = Decimal(pnl)
    t.entry_ratio = Decimal(ratio)
    t.had_stop_loss = had_sl
    t.opened_at = opened
    t.closed_at = closed
    return t


def test_mbti_default_when_few_trades():
    assert mbti_analyzer.classify_mbti([_trade(), _trade()]) == "균형 탐색가"


def test_mbti_principled_stop_loss():
    trades = [_trade(ratio="0.25", had_sl=True, hold_sec=7200) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "냉철한 원칙주의자"


def test_mbti_reckless_allin_scalper():
    trades = [_trade(ratio="1.0", had_sl=True, hold_sec=60) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "불나방 트레이더"


def test_mbti_big_short():
    trades = [
        _trade(side="SHORT", pnl="300", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "빅쇼트의 후예"


def test_mbti_bull_sniper():
    trades = [
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="-50", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "황소 저격수"

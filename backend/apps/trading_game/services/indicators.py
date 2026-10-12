"""차트 지표 순수 함수 (Phase 5b) — 골든크로스 판정."""
from __future__ import annotations

from typing import Sequence


def _ma(closes: Sequence[float], end: int, n: int) -> float:
    return sum(closes[end - n + 1:end + 1]) / n


def golden_cross_within(
    closes: Sequence[float], *, fast: int = 5, slow: int = 20, within: int = 3
) -> bool:
    """마지막 within 개 봉(오늘 포함) 안에서 fast MA 가 slow MA 를 아래→위로 교차했고 현재 fast > slow.

    교차 = 전봉 fast <= slow 이고 당봉 fast > slow. 데이터 부족이면 False.
    데드크로스는 부호를 뒤집은 시계열로 같은 함수를 호출해 판정할 수 있다.
    """
    if len(closes) < slow + within:
        return False
    last = len(closes) - 1
    if not _ma(closes, last, fast) > _ma(closes, last, slow):
        return False
    for i in range(last - within + 1, last + 1):
        prev_below = _ma(closes, i - 1, fast) <= _ma(closes, i - 1, slow)
        now_above = _ma(closes, i, fast) > _ma(closes, i, slow)
        if prev_below and now_above:
            return True
    return False

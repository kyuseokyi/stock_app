"""O'Neil / MarketSurge 베이스 단계(Stage) 계산 — 참고 base_count 그대로.

base_count(sub)(total)·라벨('1', '2', '1a')·prior_uptrend_pct 를 감지된 베이스 순서대로 계산한다.
"""
from __future__ import annotations

from typing import Any, Optional

from .kinds.base import PatternMatch

BASE_ON_BASE_ADV_THRESHOLD = 0.20  # 피벗 상승 20% 미만 = 베이스 위 베이스, 이상 = 단계 증가
# 두 베이스 사이 가격 경로가 직전 저점보다 이만큼 더 깨지면 새 상승으로 보고 1 로 리셋.
RESET_UNDERCUT_MIN = 0.10


def calculate_stage_step(
    current_pattern: PatternMatch,
    prev_pivot: Optional[float],
    prev_trough: Optional[float],
    prev_count: int = 0,
    prev_sub: int = 0,
    prev_total: int = 0,
    force_reset: bool = False,
) -> dict[str, Any]:
    """직전 상태 대비 현재 베이스의 단계. force_reset = 경로 붕괴(직전 저점 −10%)."""
    pivot = current_pattern.pivot_price
    trough = pivot * (1.0 - current_pattern.depth / 100.0)

    if prev_pivot is None or prev_count == 0:
        count, sub, total = 1, 0, 1
        prior_uptrend = None
    else:
        prior_uptrend = round(((pivot / prev_pivot) - 1.0) * 100.0, 2)

        # 1. 리셋: 경로 붕괴 또는 이번 저점이 직전 저점보다 낮음
        if force_reset or (prev_trough is not None and trough < prev_trough):
            count, sub, total = 1, 0, 1
        # 2. 베이스 위 베이스: 상승 < 20%
        elif (pivot - prev_pivot) / prev_pivot < BASE_ON_BASE_ADV_THRESHOLD:
            count = prev_count
            sub = prev_sub + 1
            total = prev_total + 1
        # 3. 단계 증가: 상승 ≥ 20%
        else:
            count = prev_count + 1
            sub = 0
            total = prev_total + 1

    label = str(count) + (chr(ord('a') + min(sub - 1, 25)) if sub > 0 else '')

    return {
        'base_count': count,
        'subcount': sub,
        'totalcount': total,
        'base_label': label,
        'prior_uptrend_pct': prior_uptrend,
        'pivot_price': pivot,
        'trough_price': trough,
    }


def _path_undercut(lows, prev_match, cur_match, prev_trough: Optional[float]) -> bool:
    """직전 베이스(돌파 후, 없으면 저점 후) ~ 현재 베이스 저점 사이 경로가 직전 저점보다
    RESET_UNDERCUT_MIN 이상 더 내려갔으면 True. lows 가 없으면 건너뜀."""
    if lows is None or prev_match is None or prev_trough is None:
        return False
    frm = prev_match.breakout_idx if prev_match.breakout_idx is not None else prev_match.trough_idx
    to = max(cur_match.h_idx, cur_match.trough_idx)
    if to <= frm:
        return False
    seg = lows[frm + 1 : to + 1]
    return len(seg) > 0 and float(min(seg)) < prev_trough * (1.0 - RESET_UNDERCUT_MIN)


def walk_bases(matches: list[PatternMatch], lows=None) -> list[dict[str, Any]]:
    """오래된 → 최신 베이스 순서로 단계 계산. 마지막 원소가 현재 베이스의 단계."""
    stages: list[dict[str, Any]] = []
    prev_pivot = prev_trough = None
    prev_match = None
    count = sub = total = 0
    for m in matches:
        force_reset = _path_undercut(lows, prev_match, m, prev_trough)
        si = calculate_stage_step(m, prev_pivot, prev_trough, count, sub, total, force_reset=force_reset)
        count, sub, total = si['base_count'], si['subcount'], si['totalcount']
        prev_pivot, prev_trough = si['pivot_price'], si['trough_price']
        prev_match = m
        stages.append(si)
    return stages

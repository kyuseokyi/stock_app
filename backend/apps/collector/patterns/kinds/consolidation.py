"""박스권(Consolidation) — 15~50% 깊이의 느슨한 횡보. 피벗 = 왼쪽 림 고가."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from ..utils import base_len, ms_base_length
from .base import BaseDetector, PatternMatch

MIN_LEN = 30  # 일봉
MIN_DEPTH = 15.0
MAX_DEPTH = 50.0
# 오른쪽 판정: 저점이 창 맨 끝(LATE_TROUGH_MAX)이고 회복도 거의 없으면(RECOVERY_MIN) 진행 중 하락 — 둘 다일 때만 제외.
RECOVERY_MIN = 0.20
LATE_TROUGH_MAX = 0.85


class ConsolidationDetector(BaseDetector):
    def __init__(self):
        super().__init__('consolidation')
        self.min_len = MIN_LEN
        self.min_depth = MIN_DEPTH
        self.max_depth = MAX_DEPTH

    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        if start_idx < 0 or end_idx >= len(df) or base_len(start_idx, end_idx) < 0:
            return None

        highs = df['high'].to_numpy(dtype=float)
        lows = df['low'].to_numpy(dtype=float)

        left_rim_price = float(highs[start_idx])
        if left_rim_price <= 0:
            return None

        window_lows = lows[start_idx : end_idx + 1]
        trough_idx = start_idx + int(np.argmin(window_lows))
        trough_price = float(lows[trough_idx])

        depth_pct = ((left_rim_price - trough_price) / left_rim_price) * 100.0
        if not (self.min_depth < depth_pct <= self.max_depth):
            return None

        span = end_idx - start_idx
        if span > 0 and left_rim_price > trough_price:
            trough_pos = (trough_idx - start_idx) / span
            recovery = (float(highs[end_idx]) - trough_price) / (left_rim_price - trough_price)
            if recovery < RECOVERY_MIN and trough_pos > LATE_TROUGH_MAX:
                return None

        pivot_price = left_rim_price
        broke_out = False
        breakout_idx: Optional[int] = None
        for j in range(trough_idx + 1, len(df)):
            if highs[j] > pivot_price:
                broke_out = True
                breakout_idx = j
                break

        right_idx = (breakout_idx - 1) if broke_out else end_idx
        if ms_base_length(start_idx, right_idx) < self.min_len:
            return None

        confidence = round(0.5 + 0.1 * broke_out, 2)

        points = [
            {'role': 'rim', 'date': dates[start_idx], 'price': round(left_rim_price, 4)},
            {'role': 'base', 'date': dates[trough_idx], 'price': round(trough_price, 4)},
            {'role': 'end', 'date': dates[right_idx], 'price': round(float(highs[right_idx]), 4)},
        ]

        return PatternMatch(
            pattern_type=self.pattern_type,
            h_idx=start_idx,
            trough_idx=trough_idx,
            end_idx=right_idx,
            pivot_price=round(pivot_price, 4),
            broke_out=broke_out,
            breakout_idx=breakout_idx,
            depth=round(depth_pct, 2),
            confidence=confidence,
            points=points,
        )

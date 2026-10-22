"""플랫 베이스(Flat Base) — 얕은(≤15%) 횡보 박스. 피벗 = 왼쪽 림 고가."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from ..utils import base_len, ms_base_length
from .base import BaseDetector, PatternMatch

MIN_LEN = 25  # 일봉
MAX_DEPTH = 15.0  # 얕고 촘촘한 박스. 하한 없음 — 촘촘할수록 강한 베이스


class FlatBaseDetector(BaseDetector):
    def __init__(self):
        super().__init__('flat_base')
        self.min_len = MIN_LEN
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
        if not (0 < depth_pct <= self.max_depth):
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

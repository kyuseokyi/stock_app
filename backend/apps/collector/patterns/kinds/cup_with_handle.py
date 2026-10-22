"""컵핸들(Cup with Handle) — 피벗 = 핸들 시작 고가(오른쪽 립)."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from ..swing import _swing_high_idxs
from ..utils import base_len, ms_base_length
from .base import PatternMatch
from .cup import CUP_TREND_MIN, CupDetector, _recovery_ok, _sma_trend

HANDLE_SWING_WIN = 5  # 일봉
HANDLE_MAX_PULLBACK = 0.13
HANDLE_PB_DEPTH_FRAC = 0.45
HANDLE_PB_CEILING = 0.20


class CupWithHandleDetector(CupDetector):
    def __init__(self):
        super().__init__('cup_with_handle')
        self.swing_win = HANDLE_SWING_WIN

    def _right_lip(
        self, wh: np.ndarray, wl: np.ndarray, bidx: int, top: float, cup_low: float
    ) -> tuple[Optional[int], float, Optional[int]]:
        """저점 뒤 위쪽 절반의 첫 스윙 고점(림 아래) 다음에 얕은 눌림이 오면 그것이 핸들.
        (립 idx, 피벗=립 고가, 핸들 저점 idx) 또는 (None, 림, None)."""
        n = len(wh)
        base_mid = (top + cup_low) / 2.0
        max_pullback = min(
            HANDLE_PB_CEILING,
            max(HANDLE_MAX_PULLBACK, HANDLE_PB_DEPTH_FRAC * (top - cup_low) / top),
        )
        for s in _swing_high_idxs(wh, self.swing_win):
            if not (s > bidx and base_mid < wh[s] < 0.999 * top):
                continue
            brk = next((j for j in range(s + 1, n) if wh[j] > wh[s]), None)
            after = wl[s + 1 : (brk if brk is not None else n)]
            if len(after) == 0:
                continue
            low_idx = s + 1 + int(np.argmin(after))
            handle_low = float(after.min())
            if (wh[s] + handle_low) / 2.0 <= base_mid:
                continue
            pullback = (wh[s] - handle_low) / wh[s]
            if 0 < pullback <= max_pullback:
                return s, float(wh[s]), low_idx
        return None, float(top), None

    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        if start_idx < 0 or end_idx >= len(df) or base_len(start_idx, end_idx) < 0:
            return None

        if _sma_trend(df, start_idx, end_idx) < CUP_TREND_MIN:
            return None

        highs = df['high'].to_numpy(dtype=float)
        lows = df['low'].to_numpy(dtype=float)
        wh = highs[start_idx : end_idx + 1]
        wl = lows[start_idx : end_idx + 1]

        top = float(wh[0])
        if top <= 0:
            return None

        bidx = int(np.argmin(wl))
        lip_rel, pivot, low_rel = self._right_lip(wh, wl, bidx, top, float(wl[bidx]))
        if lip_rel is None:  # 립 없음 → 그냥 컵
            return None

        lip_idx = start_idx + lip_rel
        handle_low_idx = start_idx + low_rel

        # 핸들을 뺀 컵 몸통(림 → 립)만 모양 판정.
        body = self.detect_cup_body(df, start_idx, lip_idx)
        if not body:
            return None

        broke_out = False
        breakout_idx: Optional[int] = None
        for j in range(handle_low_idx + 1, len(df)):
            if highs[j] > pivot:
                broke_out = True
                breakout_idx = j
                break

        right_idx = (breakout_idx - 1) if broke_out else end_idx
        if ms_base_length(start_idx, right_idx) < self.cup_min_len:
            return None

        if not _recovery_ok(highs, start_idx, lip_idx, top, broke_out):
            return None

        points = [
            {'role': 'rim', 'date': dates[start_idx], 'price': round(top, 4)},
            {'role': 'base', 'date': dates[body['trough_idx']], 'price': round(body['trough_price'], 4)},
            {'role': 'handle', 'date': dates[lip_idx], 'price': round(pivot, 4)},
            {'role': 'end', 'date': dates[handle_low_idx], 'price': round(float(wl[low_rel]), 4)},
        ]

        return PatternMatch(
            pattern_type=self.pattern_type,
            h_idx=start_idx,
            trough_idx=body['trough_idx'],
            end_idx=handle_low_idx,
            pivot_price=round(pivot, 4),
            broke_out=broke_out,
            breakout_idx=breakout_idx,
            depth=round(body['depth_pct'], 2),
            confidence=round(body['r2'], 2),
            points=points,
        )

"""쌍바닥(Double Bottom, W) — 피벗 = 가운데 고점."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from ..swing import _swing_high_idxs
from ..utils import base_len, ms_base_length
from .base import BaseDetector, PatternMatch

MIN_LEN = 30  # 일봉
SWING_WIN = 5  # 일봉
MIN_DEPTH = 15.0
MAX_DEPTH = 50.0
DB_MAX_UNDERCUT = 0.12  # MS 기준: 두 번째 바닥은 첫 바닥보다 최대 이만큼만 더 낮게
W_RECOV_MIN, W_RECOV_MAX = 0.68, 0.94
W_BOTTOM_ROUND_MAX = 6  # ±10봉 안에 바닥 근처 봉이 이 이상이면 둥근 컵 바닥(V 아님)
V_BOTTOM_BAND = 0.03
W_LEFTLEG_SLOPE_MAX = -0.2  # 림 → 첫 바닥 종가 기울기(%/봉)가 이보다 가팔라야


def _v_bottom_bars(lows: np.ndarray, idx: int, band: float = V_BOTTOM_BAND) -> int:
    lo = max(0, idx - 10)
    hi = min(len(lows), idx + 11)
    return int(np.sum(lows[lo:hi] <= lows[idx] * (1 + band)))


def _leftleg_descends(closes: np.ndarray, rim_idx: int, a: int) -> bool:
    leg = closes[rim_idx : rim_idx + a + 1]
    if len(leg) < 3 or leg.mean() <= 0:
        return False
    slope = float(np.polyfit(np.arange(len(leg), dtype=float), leg, 1)[0])
    return slope / leg.mean() * 100 < W_LEFTLEG_SLOPE_MAX


class DoubleBottomDetector(BaseDetector):
    def __init__(self):
        super().__init__('double_bottom')
        self.min_len = MIN_LEN
        self.swing_win = SWING_WIN
        self.min_depth = MIN_DEPTH
        self.max_depth = MAX_DEPTH

    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        if start_idx < 0 or end_idx >= len(df) or base_len(start_idx, end_idx) < 0:
            return None

        highs = df['high'].to_numpy(dtype=float)
        lows = df['low'].to_numpy(dtype=float)
        closes = df['close'].to_numpy(dtype=float)

        rim_price = float(highs[start_idx])
        if rim_price <= 0:
            return None

        window_highs = highs[start_idx : end_idx + 1]
        swings = _swing_high_idxs(window_highs, self.swing_win)

        best_match: Optional[PatternMatch] = None
        best_confidence: float = 0.0

        for rel_mid in swings:
            mid_idx = start_idx + rel_mid
            if not (start_idx + 3 <= mid_idx <= end_idx - 3):
                continue

            mid_price = float(highs[mid_idx])
            if mid_price > rim_price * 1.02:  # 가운데 고점은 림보다 2% 넘게 높으면 안 됨
                continue

            b1_lows = lows[start_idx : mid_idx + 1]
            b1_idx = start_idx + int(np.argmin(b1_lows))
            b1_price = float(lows[b1_idx])

            pivot_price = mid_price

            # 돌파 = 가운데 고점 이후 고가가 피벗을 넘는 첫 봉. 두 번째 바닥보다 먼저 찾아서
            # 돌파 한참 뒤의 더 깊은 하락을 두 번째 바닥으로 잡지 않게.
            broke_out = False
            breakout_idx: Optional[int] = None
            for j in range(mid_idx + 1, len(df)):
                if highs[j] > pivot_price:
                    broke_out = True
                    breakout_idx = j
                    break

            # 두 번째 바닥: 가운데 고점 ~ 돌파 전(형성 중이면 창 끝) 최저가.
            b2_hi = (breakout_idx - 1) if broke_out else end_idx
            if b2_hi <= mid_idx:
                continue
            b2_idx = mid_idx + int(np.argmin(lows[mid_idx : b2_hi + 1]))
            b2_price = float(lows[b2_idx])

            if not (start_idx <= b1_idx < mid_idx < b2_idx):
                continue

            # 1. 언더컷: 두 번째 바닥은 첫 바닥 이하, 최대 DB_MAX_UNDERCUT 까지.
            if not (b1_price * (1 - DB_MAX_UNDERCUT) <= b2_price <= b1_price):
                continue

            # 두 번째 바닥은 날카로운 V(흔들기)여야 — 둥근 컵 바닥 제외.
            if _v_bottom_bars(lows, b2_idx) >= W_BOTTOM_ROUND_MAX:
                continue

            # 2. 깊이: 림 → 더 깊은 바닥
            min_trough = min(b1_price, b2_price)
            depth_pct = ((rim_price - min_trough) / rim_price) * 100.0
            if not (self.min_depth <= depth_pct <= self.max_depth):
                continue

            # 3. 가운데 고점 회복률 — 두 바닥 모두에서 띠 안(AAPL 2025-12 사례: 첫 바닥 기준 0.50 탈락).
            if rim_price <= b1_price or rim_price <= b2_price:
                continue
            recov1 = (mid_price - b1_price) / (rim_price - b1_price)
            recov2 = (mid_price - b2_price) / (rim_price - b2_price)
            if not (W_RECOV_MIN <= recov1 <= W_RECOV_MAX and W_RECOV_MIN <= recov2 <= W_RECOV_MAX):
                continue
            recov = recov2

            # 왼쪽 다리(림 → 첫 바닥)는 실제로 내려가야 함.
            if not _leftleg_descends(closes, start_idx, b1_idx - start_idx):
                continue

            last_base_idx = b2_hi  # 베이스 끝 = 돌파 전 봉

            right_idx = last_base_idx
            if ms_base_length(start_idx, right_idx) < self.min_len:
                continue

            confidence = round(recov, 2)

            points = [
                {'role': 'rim', 'date': dates[start_idx], 'price': round(rim_price, 4)},
                {'role': 'base1', 'date': dates[b1_idx], 'price': round(b1_price, 4)},
                {'role': 'mid_peak', 'date': dates[mid_idx], 'price': round(mid_price, 4)},
                {'role': 'base2', 'date': dates[b2_idx], 'price': round(b2_price, 4)},
                {'role': 'end', 'date': dates[last_base_idx], 'price': round(float(highs[last_base_idx]), 4)},
            ]

            match = PatternMatch(
                pattern_type=self.pattern_type,
                h_idx=start_idx,
                trough_idx=b2_idx,
                end_idx=last_base_idx,
                pivot_price=round(pivot_price, 4),
                broke_out=broke_out,
                breakout_idx=breakout_idx,
                depth=round(depth_pct, 2),
                confidence=confidence,
                points=points,
            )

            if confidence > best_confidence:
                best_confidence = confidence
                best_match = match

        return best_match

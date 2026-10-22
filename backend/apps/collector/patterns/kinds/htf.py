"""하이 타이트 플래그(HTF, 일봉 전용) — 피벗 = 깃대 고점이 아닌 두 번째 고점.

MS 가 그리지 않는 패턴이라 화면 기준이 없다 — 기준값은 보수적으로, O'Neil 규칙·합성 데이터로 검증.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from ..swing import _prominent_swing_highs
from ..utils import ms_base_length
from .base import BaseDetector, PatternMatch

MIN_LEN = 15  # 깃발 길이: 3~5주
MAX_LEN = 25
MIN_DEPTH = 5.0  # 이만큼은 조정해야 깃발(거의 평평한 것 제외)
MAX_DEPTH = 15.0  # 촘촘한 깃발
FLAGPOLE_ADVANCE_MIN = 100.0  # 깃대: 조회 구간 안에서 대략 두 배
FLAGPOLE_LOOKBACK = 40  # 깃대 고점까지 ~8주
SWING_WIN = 3  # 깃발 안 피벗 스윙 반창
# 깃발 안 피벗 스윙의 ATR 돌출도. 림(2.25)보다 느슨 — 촘촘한 깃발의 두 번째 고점은 돌출이 작다.
SWING_K = 1.0
# 깃대 고점은 직전 ~1년 고점 근처(신고가 영역)여야 — 중간 구간 변동을 깃대로 오인하지 않게.
NEW_HIGH_WIN = 250
NEW_HIGH_MIN = 0.98
# 수정주가 미반영 보호: 하루 종가 변동이 50% 를 넘는 깃대는 제외(감자·증자 왜곡).
SPLIT_JUMP = 0.5


def _flag_swings(df: pd.DataFrame, highs, lows, closes) -> list[int]:
    """깃발 피벗 후보 스윙(전 구간, 인자 고정) — df 마다 메모이즈(결과 동일, 반복 계산만 제거)."""
    peaks = df.attrs.get('_htf_swings')
    if peaks is None:
        peaks = df.attrs['_htf_swings'] = _prominent_swing_highs(highs, lows, closes, SWING_WIN, SWING_K)
    return peaks


class HighTightFlagDetector(BaseDetector):
    def __init__(self):
        super().__init__('high_tight_flag')
        self.min_len = MIN_LEN  # 스캔의 거친 사전 필터가 짧은 깃발을 통과시키도록 공개

    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        """start_idx = 깃대 고점(+100% 상승 끝). 피벗 = 고점 이후 첫 돌출 스윙 고점(두 번째 고점)."""
        if start_idx < 0 or end_idx >= len(df) or end_idx <= start_idx:
            return None

        highs = df['high'].to_numpy(dtype=float)
        lows = df['low'].to_numpy(dtype=float)
        closes = df['close'].to_numpy(dtype=float)

        pole_peak_price = float(highs[start_idx])
        if pole_peak_price <= 0:
            return None

        # 신고가 판정
        lookback_hi = float(np.max(highs[max(0, start_idx - NEW_HIGH_WIN) : start_idx + 1]))
        if pole_peak_price < NEW_HIGH_MIN * lookback_hi:
            return None

        # 깃대 판정: 조회 구간 안 ~+100% 상승. 깃대 저점 봉도 기록(차트 표시용).
        pole_start = max(0, start_idx - FLAGPOLE_LOOKBACK)
        pole_low_idx = pole_start + int(np.argmin(lows[pole_start : start_idx + 1]))
        pole_low = float(lows[pole_low_idx])
        if pole_low <= 0:
            return None
        if ((pole_peak_price - pole_low) / pole_low) * 100.0 < FLAGPOLE_ADVANCE_MIN:
            return None

        # 수정주가 미반영 보호: 깃대 구간에 하루 종가 변동 50% 초과가 있으면 제외.
        pole_c = closes[max(0, start_idx - FLAGPOLE_LOOKBACK) : start_idx + 1]
        if len(pole_c) > 1:
            with np.errstate(divide='ignore', invalid='ignore'):
                jump = float(np.max(np.abs(np.diff(pole_c) / pole_c[:-1])))
            if jump > SPLIT_JUMP:
                return None

        # 피벗 = 두 번째 고점: 깃대 고점 뒤 깃발 안 첫 돌출 스윙 고점.
        peaks = _flag_swings(df, highs, lows, closes)
        pivot_idx = next((p for p in peaks if start_idx < p <= end_idx), None)
        if pivot_idx is None:
            return None
        pivot_price = float(highs[pivot_idx])

        broke_out = False
        breakout_idx: Optional[int] = None
        for j in range(pivot_idx + 1, len(df)):
            if highs[j] > pivot_price:
                broke_out = True
                breakout_idx = j
                break

        # MS 길이 판정(고점..마지막 깃발 봉, 돌파봉 제외), 상·하한 모두.
        right_idx = (breakout_idx - 1) if broke_out else end_idx
        if not (MIN_LEN <= ms_base_length(start_idx, right_idx) <= MAX_LEN):
            return None

        # 깊이는 깃발 구간 [고점..right_idx] 만으로(넓은 스캔 창의 더 깊은 저점이 섞이지 않게).
        trough_idx = start_idx + int(np.argmin(lows[start_idx : right_idx + 1]))
        trough_price = float(lows[trough_idx])
        depth_pct = ((pole_peak_price - trough_price) / pole_peak_price) * 100.0
        if not (MIN_DEPTH <= depth_pct <= MAX_DEPTH):
            return None

        confidence = round(0.6 + 0.1 * broke_out, 2)

        points = [
            {'role': 'pole', 'date': dates[pole_low_idx], 'price': round(pole_low, 4)},
            {'role': 'rim', 'date': dates[start_idx], 'price': round(pole_peak_price, 4)},
            {'role': 'pivot', 'date': dates[pivot_idx], 'price': round(pivot_price, 4)},
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

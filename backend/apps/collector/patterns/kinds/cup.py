"""컵(Cup) — 둥근 U 자 베이스. 피벗 = 왼쪽 림 고가."""
from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd

from ..utils import get_bar_count, ms_base_length
from .base import BaseDetector, PatternMatch

# MS 는 얕은 둥근 U(~8%+)도 컵으로 그린다. 컵과 평평한 박스를 가르는 것은 깊이가 아니라 모양(R^2·둥근 바닥).
CUP_MIN_DEPTH = 8.0
CUP_MAX_DEPTH = 50.0
CUP_MIN_R2 = 0.45

CUP_RECOVERY_REGION = 0.72
CUP_RECOVERY_MIN = 0.85

CUP_RESCUE_DEPTH_MIN = 0.20
CUP_RESCUE_DEPTH_MAX = 0.40
CUP_RESCUE_LOWPOS_MAX = 0.55
CUP_RESCUE_RECOV_MIN = 0.78

CUP_MIN_LEN = 30  # 일봉
BOTTOM_BARS = 3  # 일봉
CUP_BOTTOM_BAND = 0.25

# 컵은 건강한 상승 중 쉬어 가는 자리: 베이스 동안 50봉 이평이 이만큼 이상 꺾이면 추세 정체(박스권).
CUP_TREND_MIN = -0.15


def _sma_trend(df: pd.DataFrame, a: int, b: int, period: int = 50) -> float:
    """베이스 창(림→끝) 동안 period 봉 이평의 변화율. 음수 = 중기 추세 붕괴. df 마다 메모이즈."""
    s50 = df.attrs.get('_cp_sma50')
    if s50 is None:
        s50 = df.attrs['_cp_sma50'] = (
            df['close'].rolling(period, min_periods=period // 2).mean().to_numpy(dtype=float)
        )
    va, vb = s50[a], s50[b]
    if not va or np.isnan(va) or np.isnan(vb):
        return 0.0
    return (vb - va) / va


def _parabola_fit(closes: np.ndarray) -> tuple[float, float]:
    """종가를 [-1, 1] 위 이차식 y = a*x^2 + b*x + c 로 맞춘다. (a, R^2) 반환."""
    n = len(closes)
    if n < 5:
        return 0.0, 0.0
    x = np.linspace(-1, 1, n)
    try:
        poly = np.polyfit(x, closes, 2)
        fit = np.polyval(poly, x)
        ss_tot = float(np.sum((closes - np.mean(closes)) ** 2))
        ss_res = float(np.sum((closes - fit) ** 2))
        r2 = (1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 0.0
        return float(poly[0]), float(r2)
    except Exception:
        return 0.0, 0.0


def _is_asymmetric_cup(
    closes: np.ndarray, peak: int, end: int, base_idx: int, base_price: float, top: float
) -> bool:
    span = end - peak
    if span <= 0 or top <= base_price:
        return False
    depth = (top - base_price) / top
    if not (CUP_RESCUE_DEPTH_MIN < depth <= CUP_RESCUE_DEPTH_MAX):
        return False
    low_pos = (base_idx - peak) / span
    recov = (closes[end] - base_price) / (top - base_price)
    return low_pos <= CUP_RESCUE_LOWPOS_MAX and recov >= CUP_RESCUE_RECOV_MIN


def _recovery_ok(highs: np.ndarray, body_start: int, body_end: int, rim: float, broke_out: bool) -> bool:
    if broke_out:
        return True
    bn = get_bar_count(body_start, body_end)
    region = highs[body_start + int(CUP_RECOVERY_REGION * bn) : body_end + 1]
    return len(region) > 0 and float(np.max(region)) >= CUP_RECOVERY_MIN * rim


class CupDetector(BaseDetector):
    def __init__(self, pattern_type: str = 'cup'):
        super().__init__(pattern_type)
        self.cup_min_len = CUP_MIN_LEN
        self.bottom_bars = BOTTOM_BARS
        self.min_depth = CUP_MIN_DEPTH
        self.max_depth = CUP_MAX_DEPTH
        self.min_r2 = CUP_MIN_R2

    def detect_cup_body(self, df: pd.DataFrame, start_idx: int, end_idx: int) -> Optional[dict[str, Any]]:
        """창 [start_idx, end_idx] 가 컵 몸통인지 판정. 몸통 지표 dict 또는 None."""
        length = get_bar_count(start_idx, end_idx)
        if length < 1 or start_idx < 0 or end_idx >= len(df):
            return None

        highs = df['high'].to_numpy(dtype=float)
        lows = df['low'].to_numpy(dtype=float)
        closes = df['close'].to_numpy(dtype=float)

        left_rim_price = float(highs[start_idx])
        if left_rim_price <= 0:
            return None

        window_lows = lows[start_idx : end_idx + 1]
        trough_rel_idx = int(np.argmin(window_lows))
        trough_idx = start_idx + trough_rel_idx
        trough_price = float(lows[trough_idx])

        # 1. 저점 위치: 대략 가운데(창의 0.12~0.90)
        trough_ratio = trough_rel_idx / (length - 1) if length > 1 else 0.5
        if not (0.12 <= trough_ratio <= 0.90):
            return None

        # 2. 깊이
        depth_pct = ((left_rim_price - trough_price) / left_rim_price) * 100.0
        if not (self.min_depth <= depth_pct <= self.max_depth):
            return None

        right_rim_price = float(highs[end_idx])
        height = left_rim_price - trough_price
        if height <= 0:
            return None

        # 3. 둥근 바닥: 바닥 근처 봉이 충분해야(아니면 V 자). 오른쪽 회복 판정은 detect_window 에서.
        band = trough_price + CUP_BOTTOM_BAND * height
        if int(np.sum(window_lows <= band)) < self.bottom_bars:
            return None

        # 4. 포물선 U 자 적합
        window_closes = closes[start_idx : end_idx + 1]
        poly_a, r2 = _parabola_fit(window_closes)
        if poly_a <= 0:
            return None

        if r2 < self.min_r2 and not _is_asymmetric_cup(
            closes, start_idx, end_idx, trough_idx, trough_price, left_rim_price
        ):
            return None

        return {
            'left_rim_idx': start_idx,
            'left_rim_price': left_rim_price,
            'trough_idx': trough_idx,
            'trough_price': trough_price,
            'right_rim_idx': end_idx,
            'right_rim_price': right_rim_price,
            'depth_pct': depth_pct,
            'r2': r2,
        }

    def detect_window(
        self, df: pd.DataFrame, dates: list[str], start_idx: int, end_idx: int
    ) -> Optional[PatternMatch]:
        body = self.detect_cup_body(df, start_idx, end_idx)
        if not body:
            return None

        # 베이스 동안 50 이평 붕괴 → 정체된 박스권이지 컵이 아님(양보).
        if _sma_trend(df, start_idx, end_idx) < CUP_TREND_MIN:
            return None

        highs = df['high'].to_numpy(dtype=float)

        pivot_price = body['left_rim_price']
        trough_idx = body['trough_idx']

        # 돌파 = 저점 이후 고가가 피벗을 넘는 첫 봉(장중).
        broke_out = False
        breakout_idx: Optional[int] = None
        for j in range(trough_idx + 1, len(df)):
            if highs[j] > pivot_price:
                broke_out = True
                breakout_idx = j
                break

        # MS 길이 판정(림..마지막 베이스 봉, 돌파봉 제외).
        right_idx = (breakout_idx - 1) if broke_out else end_idx
        if ms_base_length(start_idx, right_idx) < self.cup_min_len:
            return None

        # 형성 중 컵의 오른쪽 회복 판정(돌파한 컵은 면제).
        if not _recovery_ok(highs, start_idx, end_idx, pivot_price, broke_out):
            return None

        confidence = round(body['r2'], 2)  # 포물선 적합도(R^2)

        points = [
            {'role': 'rim', 'date': dates[start_idx], 'price': round(body['left_rim_price'], 4)},
            {'role': 'base', 'date': dates[trough_idx], 'price': round(body['trough_price'], 4)},
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
            depth=round(body['depth_pct'], 2),
            confidence=confidence,
            points=points,
        )

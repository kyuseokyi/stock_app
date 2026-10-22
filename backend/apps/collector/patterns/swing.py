"""스윙 고점·ATR — 참고 base_finder 중 엔진이 쓰는 세 함수만."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(closes)
    tr = np.empty(n)
    tr[0] = highs[0] - lows[0]
    tr[1:] = np.maximum.reduce(
        [
            highs[1:] - lows[1:],
            np.abs(highs[1:] - closes[:-1]),
            np.abs(lows[1:] - closes[:-1]),
        ]
    )
    return pd.Series(tr).rolling(period, min_periods=1).mean().to_numpy()


def _swing_high_idxs(highs: np.ndarray, win: int) -> list[int]:
    n = len(highs)
    return [i for i in range(win, n - win) if highs[i] == highs[i - win : i + win + 1].max()]


def _prominent_swing_highs(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, win: int, k: float
) -> list[int]:
    """ATR 스케일 돌출도가 k 이상인 스윙 고점(win). 돌출도 = 고가 − max(왼쪽 바닥, 오른쪽 바닥),
    각 바닥은 고점과 그보다 엄격히 높은 가장 가까운 고가 사이의 최저가(더 높은 쪽이 없으면 유지)."""
    peaks = _swing_high_idxs(highs, win)
    if k <= 0 or len(peaks) <= 1:
        return peaks
    atr = _atr(highs, lows, closes)
    n = len(highs)
    keep = []
    for i in peaks:
        bases = []
        for step in (-1, 1):
            j, trough = i + step, lows[i]
            while 0 <= j < n and highs[j] <= highs[i]:
                trough = min(trough, lows[j])
                j += step
            if 0 <= j < n:  # 더 높은 고가가 이쪽을 막는다
                bases.append(trough)
        if not bases or (highs[i] - max(bases)) >= k * atr[i]:
            keep.append(i)
    return keep

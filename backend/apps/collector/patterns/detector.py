"""차트 패턴 엔진(일봉) — 참고 v2 PatternDetectorEngine 의 감지·선택·단계·변환을 순수 함수로 이식.

detect(bars) → 전 구간을 베이스 순서로 나누고(후보 생성 → 병합 → flat 흡수 → 겹침 제거 → 형성 중 하나만),
O'Neil 단계를 센 뒤 표시 구간(마지막 display_bars 봉)에 걸친 베이스만 Base 로 돌려준다.
판정 로직·기준값은 참고 코드와 같다(MarketSurge 화면에 맞춘 값).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from .base_count import walk_bases
from .constants import DISPLAY_BARS, MAX_LEN, MIN_LEN, PEAK_ATR_K, SWING_WIN
from .kinds import (
    BaseDetector,
    ConsolidationDetector,
    CupDetector,
    CupWithHandleDetector,
    DoubleBottomDetector,
    FlatBaseDetector,
    HighTightFlagDetector,
    PatternMatch,
)
from .swing import _prominent_swing_highs
from .utils import get_bar_count, ms_base_length

# 직전 고점 판정: 베이스는 최근 고점 근처에서 생긴다. 직전 60봉 최고가의 95% 미만인 림은
# 하락 중 반등(낮은 고점)이지 베이스가 아니다 — MS 도 그리지 않는다.
_RIM_HIGH_WIN = 60
_RIM_HIGH_MIN = 0.95

# 같은 돌파를 공유하는 두 후보는, 사이에 앞 림의 93% 이상 회복이 없을 때만 같은 베이스(가장 넓은 림으로 병합).
# 회복이 있었다면 앞 베이스가 오른쪽을 완성한 뒤 새 베이스가 생긴 것 — 둘 다 유지(ACWX 사례).
_REC_SEP = 0.93

# 림보다 낮은 립/가운데 고점에서 돌파하는 모양 — 회복 고점 하위 창이 필요하다.
_LOWER_PIVOT_PATTERNS = {'cup_with_handle', 'double_bottom'}

_SPECIFIC_PATTERNS = {'cup_with_handle', 'cup', 'double_bottom', 'high_tight_flag'}
# 같은 등급 안에서 cup 은 느슨한 대체 → 엄격한 모양(컵핸들·쌍바닥)에 진다.
_PATTERN_ORDER = {
    'high_tight_flag': 0,
    'cup_with_handle': 0,
    'double_bottom': 1,
    'cup': 2,
    'flat_base': 0,
    'consolidation': 1,
}

# 외부 노출 이름(내부 'high_tight_flag' → 'htf'). 내부 키는 참고 코드와 같게 둔다(순위·게이트가 이 이름을 씀).
_PUBLIC_NAME = {'high_tight_flag': 'htf'}


@dataclass(frozen=True)
class Base:
    pattern_type: str  # cup | cup_with_handle | double_bottom | flat_base | consolidation | htf
    rim_date: date
    low_date: Optional[date]
    low_price: Optional[float]
    pivot: float
    depth: float
    length: int
    is_active: bool  # 돌파 전 True
    breakout_date: Optional[date]
    breakout_price_pct: Optional[float]
    breakout_vol_pct: Optional[float]
    days_since_breakout: Optional[int]
    base_count: int
    subcount: int
    totalcount: int
    label: str
    prior_uptrend_pct: Optional[float]
    confidence: float
    points: tuple[dict, ...]  # ({"role":..., "date": "YYYY-MM-DD", "price": float}, ...)


def _rank_key(m: PatternMatch) -> tuple[int, int, float, int]:
    """후보 선택 순서(작을수록 우선): 구체적 모양 > 일반, 같은 등급은 패턴 우선순위 → 높은 신뢰도 → 긴 베이스."""
    tier = 0 if m.pattern_type in _SPECIFIC_PATTERNS else 1
    return (tier, _PATTERN_ORDER.get(m.pattern_type, 9), -m.confidence, -(m.end_idx - m.h_idx))


def build_detectors() -> list[BaseDetector]:
    # 순서 유지: _rank_key 비교가 엄격한 '<' 라 동점이면 먼저 나온 감지기가 이긴다.
    return [
        HighTightFlagDetector(),
        DoubleBottomDetector(),
        CupWithHandleDetector(),
        CupDetector(),
        FlatBaseDetector(),
        ConsolidationDetector(),
    ]


def _calculate_breakout_metrics(
    df: pd.DataFrame, breakout_idx: Optional[int], vol_win: int = 50
) -> tuple[Optional[float], Optional[float]]:
    """돌파봉의 (종가 등락 %, 50봉 평균 대비 거래량 %)."""
    if breakout_idx is None or breakout_idx <= 0 or breakout_idx >= len(df):
        return None, None

    closes = df['close'].to_numpy(dtype=float)
    vols = df['volume'].to_numpy(dtype=float)

    prev_close = closes[breakout_idx - 1]
    curr_close = closes[breakout_idx]
    price_pct = float(round(((curr_close / prev_close) - 1.0) * 100.0, 2)) if prev_close > 0 else None
    if price_pct is not None and not math.isfinite(price_pct):
        price_pct = None

    lo = max(0, breakout_idx - vol_win + 1)
    window_vols = vols[lo : breakout_idx + 1]
    avg_vol = float(np.nanmean(window_vols)) if len(window_vols) > 0 else 0.0

    curr_vol = vols[breakout_idx]
    vol_pct = (
        float(round(((curr_vol / avg_vol) - 1.0) * 100.0, 2))
        if avg_vol > 0 and not np.isnan(curr_vol)
        else None
    )
    if vol_pct is not None and not math.isfinite(vol_pct):
        vol_pct = None
    return price_pct, vol_pct


def _scan_candidates(
    df: pd.DataFrame,
    dates: list[str],
    detectors: list[BaseDetector],
    lo: int,
    hi: int,
    min_len: int = MIN_LEN,
    max_len: int = MAX_LEN,
    win: int = SWING_WIN,
) -> list[PatternMatch]:
    """[lo, hi] 안의 돌출 스윙 고점마다 림 후보로 창을 만들어 감지기를 돌린다(창마다 최선 1개)."""
    highs = df['high'].to_numpy(dtype=float)
    lows = df['low'].to_numpy(dtype=float)
    closes = df['close'].to_numpy(dtype=float)
    n = len(df)
    peaks = _prominent_swing_highs(highs, lows, closes, win, PEAK_ATR_K)

    # 회복 고점 하위 창은 림 아래에서 돌파하는 모양(컵핸들·쌍바닥)만 — 나머지는 림 회복 창에서만 완성된다.
    sub_detectors = [d for d in detectors if d.pattern_type in _LOWER_PIVOT_PATTERNS]

    candidates: list[PatternMatch] = []
    for peak in peaks:
        if peak < lo or peak > hi:
            continue
        # 직전 고점 판정: 최근 고점보다 한참 낮은 림(하락 중 반등)은 건너뜀.
        if peak >= _RIM_HIGH_WIN and (highs[peak] < _RIM_HIGH_MIN * highs[peak - _RIM_HIGH_WIN : peak].max()):
            continue
        top = highs[peak]
        rim_bo = next((j for j in range(peak + 1, n) if highs[j] > top), None)
        # 베이스 창에는 림보다 높은 봉이 없어야 → 림 돌파 전 봉(또는 max_len)에서 자름. 가장 넓은 창.
        cap = min(hi, peak + max_len - 1, (rim_bo - 1) if rim_bo is not None else hi)
        # 끝 후보: cap(림 회복, 감지기 전부) + 각 내부 회복 고점 r(베이스 중간 위, 림 아래)이 돌파되기 전 봉
        # (림 아래 피벗 감지기만). 컵핸들·쌍바닥은 림 회복 한참 전에 완성되기 때문.
        end_dets = {cap: detectors}
        for r in peaks:
            if not (peak < r <= cap):
                continue
            base_mid = (top + float(lows[peak : r + 1].min())) / 2.0
            if not (base_mid < highs[r] < top):
                continue
            br = next((j for j in range(r + 1, n) if highs[j] > highs[r]), None)
            e2 = min((br - 1) if br is not None else hi, cap)
            if e2 not in end_dets:  # cap 창의 감지기 집합은 낮추지 않음
                end_dets[e2] = sub_detectors

        for end in sorted(end_dets):
            # 거친 MS 길이 사전 필터. HTF(15~24봉)가 이 끝에서 돌면 하한을 HTF 최소로 낮춘다.
            htf = next((d for d in end_dets[end] if d.pattern_type == 'high_tight_flag'), None)
            gate = htf.min_len if htf is not None else min_len
            if ms_base_length(peak, end) < gate:
                continue
            best: Optional[PatternMatch] = None
            for detector in end_dets[end]:
                match = detector.detect_window(df, dates, start_idx=peak, end_idx=end)
                if match and (best is None or _rank_key(match) < _rank_key(best)):
                    best = match
            if best is None:
                continue
            # max_len 안에 림을 되찾지 못하면 '한참 뒤 돌파'가 아니라 형성 중 — 창 끝으로 자른다.
            if best.broke_out and best.breakout_idx is not None and best.breakout_idx - best.h_idx > max_len:
                best.broke_out = False
                best.breakout_idx = None
                best.end_idx = end
            candidates.append(best)
    return candidates


def _select(candidates: list[PatternMatch], highs: np.ndarray, n: int) -> list[PatternMatch]:
    """후보 → 베이스 순서: 같은 베이스 병합 → flat 흡수 → 겹침 제거(순위 우선) → 형성 중은 마지막 하나만."""

    # 같은 모양·같은 끝(같은 돌파 또는 둘 다 형성 중)이고 사이에 회복이 없으면 같은 베이스 → 가장 이른 림.
    def _end_sig(m: PatternMatch) -> int:
        return m.breakout_idx if (m.broke_out and m.breakout_idx is not None) else n

    groups: dict[tuple[str, int], list[PatternMatch]] = {}
    for m in candidates:
        groups.setdefault((m.pattern_type, _end_sig(m)), []).append(m)
    collapsed: list[PatternMatch] = []
    for grp in groups.values():
        grp.sort(key=lambda m: m.h_idx)
        reps: list[PatternMatch] = []
        for m in grp:
            same_base = any(
                rep.h_idx < m.h_idx and float(highs[rep.h_idx + 1 : m.h_idx + 1].max()) < _REC_SEP * highs[rep.h_idx]
                for rep in reps
            )
            if not same_base:
                reps.append(m)
        collapsed.extend(reps)
    candidates = collapsed

    # flat_base 흡수: 같은 봉에서 돌파하고 림이 같거나 앞선 consolidation 이 있으면 한 베이스(넓은 쪽, AAMI 사례).
    cons_by_bo: dict[int, PatternMatch] = {
        m.breakout_idx: m
        for m in candidates
        if m.pattern_type == 'consolidation' and m.broke_out and m.breakout_idx is not None
    }
    candidates = [
        m
        for m in candidates
        if not (
            m.pattern_type == 'flat_base'
            and m.broke_out
            and m.breakout_idx in cons_by_bo
            and cons_by_bo[m.breakout_idx].h_idx <= m.h_idx
        )
    ]

    # 겹침 제거: 순위 좋은 것부터, 이미 고른 베이스 구간과 겹치지 않을 때만 채택.
    chosen: list[PatternMatch] = []
    for m in sorted(candidates, key=_rank_key):
        if all(m.end_idx < c.h_idx or m.h_idx > c.end_idx for c in chosen):
            chosen.append(m)

    chosen.sort(key=lambda m: m.h_idx)
    # 형성 중(미돌파) 베이스는 가장 최근 것만 — 뒤에 다른 베이스가 있는 미돌파 베이스는 실패한 것.
    if chosen:
        chosen = [m for i, m in enumerate(chosen) if m.broke_out or i == len(chosen) - 1]
    return chosen


def scan_bases(df: pd.DataFrame, dates: list[str], detectors: Optional[list[BaseDetector]] = None) -> list[PatternMatch]:
    """전 구간 [0, n-1] 의 베이스 순서(오래된 → 최신)."""
    n = len(df)
    if n == 0:
        return []
    candidates = _scan_candidates(df, dates, detectors or build_detectors(), 0, n - 1)
    return _select(candidates, df['high'].to_numpy(dtype=float), n)


def _finite_pos(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


def _to_frame(bars: list[tuple]) -> tuple[pd.DataFrame, list[date]]:
    """[(date, o, h, l, c, v)] → float DataFrame. 고가·저가·종가가 없거나 0 이하·비유한인 봉은 뺀다
    (참고 normalize_df 는 float 변환만 — 이상 봉 제거는 예외 방지용으로 더한 것). 거래량 이상값은 NaN."""
    rows = []
    ds: list[date] = []
    for b in bars or []:
        if b is None or len(b) < 6 or b[0] is None:
            continue
        h, l, c = _finite_pos(b[2]), _finite_pos(b[3]), _finite_pos(b[4])
        if h is None or l is None or c is None:
            continue
        o = _finite_pos(b[1]) or c
        try:
            v = float(b[5]) if b[5] is not None else float('nan')
            if not math.isfinite(v):
                v = float('nan')
        except (TypeError, ValueError):
            v = float('nan')
        rows.append((o, h, l, c, v))
        ds.append(b[0])
    df = pd.DataFrame(rows, columns=['open', 'high', 'low', 'close', 'volume'], dtype=float)
    return df, ds


def detect(bars: list[tuple], display_bars: int = DISPLAY_BARS) -> list[Base]:
    """일봉 [(date, open, high, low, close, volume)] 오름차순 → 표시 구간에 걸친 베이스(오래된 → 최신)."""
    df, ds = _to_frame(bars)
    n = len(df)
    if n == 0:
        return []
    dates = [d.isoformat() if hasattr(d, 'isoformat') else str(d) for d in ds]

    seq = scan_bases(df, dates)
    if not seq:
        return []
    stages = walk_bases(seq, lows=df['low'].to_numpy(dtype=float))
    # 단계는 전 구간(여유 + 표시)으로 세고, 반환은 마지막 display_bars 봉에 걸친 베이스만.
    serve_from = max(0, n - display_bars)

    out: list[Base] = []
    for m, st in zip(seq, stages):
        broke = m.broke_out and m.breakout_idx is not None
        visible_right = m.breakout_idx if broke else m.end_idx
        if visible_right < serve_from:
            continue
        price_pct, vol_pct = _calculate_breakout_metrics(df, m.breakout_idx)
        # 길이 = 림..마지막 베이스 봉 포함(돌파봉 제외). 쌍바닥 end_idx 가 피벗 뒤로 넘어가는 경우도 피한다.
        right_idx = m.breakout_idx - 1 if broke else m.end_idx
        bo_ok = m.breakout_idx is not None and 0 < m.breakout_idx < n
        out.append(
            Base(
                pattern_type=_PUBLIC_NAME.get(m.pattern_type, m.pattern_type),
                rim_date=ds[m.h_idx],
                low_date=ds[m.trough_idx],
                low_price=round(m.pivot_price * (1.0 - m.depth / 100.0), 4),
                pivot=m.pivot_price,
                depth=m.depth,
                length=ms_base_length(m.h_idx, right_idx),
                is_active=not m.broke_out,
                breakout_date=ds[m.breakout_idx] if bo_ok else None,
                breakout_price_pct=price_pct,
                breakout_vol_pct=vol_pct,
                days_since_breakout=get_bar_count(m.breakout_idx, n - 1) if broke else None,
                base_count=st['base_count'],
                subcount=st['subcount'],
                totalcount=st['totalcount'],
                label=st['base_label'],
                prior_uptrend_pct=st['prior_uptrend_pct'],
                confidence=m.confidence,
                points=tuple(dict(p) for p in m.points),
            )
        )
    return out

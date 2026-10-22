"""차트 패턴 감지기(일봉) — 참고 validation 스크립트의 합성 시나리오 + 비감지 케이스.

피벗 위치·돌파(고가 > 피벗 첫 봉)·길이(돌파봉 제외)·깊이를 확인한다. 실데이터·DB 없음.
"""
import numpy as np
import pandas as pd

from apps.collector.patterns.kinds import (
    ConsolidationDetector,
    CupDetector,
    CupWithHandleDetector,
    DoubleBottomDetector,
    FlatBaseDetector,
    HighTightFlagDetector,
)
from apps.collector.patterns.utils import ms_base_length
from tests.patterns_helpers import htf_prices as _htf_prices


def _frame(closes, hi=1.0, lo=1.0, pct=False):
    closes = [float(c) for c in closes]
    if pct:
        highs = [c * hi for c in closes]
        lows = [c * lo for c in closes]
    else:
        highs = [c + hi for c in closes]
        lows = [c - lo for c in closes]
    df = pd.DataFrame({"open": closes, "high": highs, "low": lows, "close": closes,
                       "volume": [100000.0] * len(closes)})
    dates = pd.date_range("2025-01-01", periods=len(closes)).strftime("%Y-%m-%d").tolist()
    return df, dates


def _first_break(df, pivot, after):
    highs = df["high"].to_numpy()
    return next(j for j in range(after + 1, len(df)) if highs[j] > pivot)


# ---------------------------------------------------------------- 컵
def _cup_closes(depth_amp=20.0):
    x = np.linspace(-1, 1, 50)
    return [90.0] * 5 + (depth_amp * (x ** 2) + (100.0 - depth_amp)).tolist() + [105.0] * 5


def test_cup_detected_with_breakout_length_depth():
    df, dates = _frame(_cup_closes())
    m = CupDetector().detect_window(df, dates, start_idx=5, end_idx=54)
    assert m is not None and m.pattern_type == "cup"
    assert m.pivot_price == 101.0  # 왼쪽 림 고가
    assert 18.0 <= m.depth <= 22.0
    assert m.broke_out and m.breakout_idx == _first_break(df, 101.0, m.trough_idx) == 55
    assert m.end_idx == 54 and ms_base_length(m.h_idx, m.breakout_idx - 1) == 50  # 돌파봉 제외
    assert 0.45 <= m.confidence <= 1.0
    assert [p["role"] for p in m.points] == ["rim", "base", "end"]
    assert m.points[0]["date"] == dates[5]


def test_cup_rejects_v_bottom():
    # 바닥 띠(저점 + 높이 25%) 안 봉이 1개뿐인 하루짜리 급락 바닥 — 둥근 바닥 판정(3봉)에서 탈락
    v = np.concatenate([np.linspace(100, 95, 24), [80.0], np.linspace(95, 100, 24)])
    df, dates = _frame([90.0] * 5 + v.tolist() + [105.0] * 5, hi=0.1, lo=0.1)
    assert CupDetector().detect_window(df, dates, 5, 5 + len(v) - 1) is None


def test_cup_rejects_too_deep():
    df, dates = _frame(_cup_closes(depth_amp=60.0))  # 깊이 ~60% > 50%
    assert CupDetector().detect_window(df, dates, 5, 54) is None


def test_cup_rejects_too_short():
    x = np.linspace(-1, 1, 20)  # 20봉 < 컵 최소 30봉
    df, dates = _frame([90.0] * 5 + (20 * x ** 2 + 80).tolist() + [105.0] * 5)
    assert CupDetector().detect_window(df, dates, 5, 24) is None


# ---------------------------------------------------------------- 컵핸들
def _cwh_closes():
    xb = np.linspace(-1, 1, 29)
    cup = (26.0 * (xb ** 2) - 2.0 * xb + 72.0).tolist()
    return cup + [94.0, 92.0, 90.0, 89.0, 91.0] + [95.0, 98.0, 100.0, 102.0, 103.0]


def test_cup_with_handle_pivot_is_handle_start_high():
    df, dates = _frame(_cwh_closes())
    m = CupWithHandleDetector().detect_window(df, dates, 0, len(df) - 1)
    assert m is not None and m.pattern_type == "cup_with_handle"
    handle = next(p for p in m.points if p["role"] == "handle")
    lip_idx = dates.index(handle["date"])
    # 피벗 = 핸들 시작(립) 고가, 림(왼쪽 고점)보다 낮다
    assert m.pivot_price == round(float(df["high"].iloc[lip_idx]), 4)
    assert m.pivot_price < float(df["high"].iloc[0])
    assert m.broke_out and m.breakout_idx == _first_break(df, m.pivot_price, m.end_idx)
    assert [p["role"] for p in m.points] == ["rim", "base", "handle", "end"]


def test_cup_with_handle_rejects_plain_cup():
    df, dates = _frame(_cup_closes())  # 핸들(립 뒤 눌림) 없음
    assert CupWithHandleDetector().detect_window(df, dates, 5, 54) is None


# ---------------------------------------------------------------- 쌍바닥
def _w_closes(b2_low=78.0):
    w = (np.linspace(100, 80, 10).tolist() + np.linspace(80, 94, 10).tolist()
         + np.linspace(94, b2_low, 12).tolist() + np.linspace(b2_low, 95, 13).tolist())
    return [95.0] * 5 + w + [95.0] * 5 + [98.0] * 5


def test_double_bottom_pivot_is_mid_peak():
    df, dates = _frame(_w_closes())
    m = DoubleBottomDetector().detect_window(df, dates, start_idx=5, end_idx=49)
    assert m is not None and m.pattern_type == "double_bottom"
    mid = next(p for p in m.points if p["role"] == "mid_peak")
    assert m.pivot_price == mid["price"] == 95.0  # 가운데 고점 고가(94+1)
    b1 = next(p for p in m.points if p["role"] == "base1")["price"]
    b2 = next(p for p in m.points if p["role"] == "base2")["price"]
    assert b2 <= b1  # 두 번째 바닥이 언더컷
    assert m.broke_out and m.breakout_idx == _first_break(df, m.pivot_price, dates.index(mid["date"]))
    assert m.end_idx == m.breakout_idx - 1
    assert [p["role"] for p in m.points] == ["rim", "base1", "mid_peak", "base2", "end"]


def test_double_bottom_rejects_deep_undercut():
    # 두 번째 바닥이 첫 바닥보다 12% 넘게 낮음(80 → 65)
    df, dates = _frame(_w_closes(b2_low=65.0))
    assert DoubleBottomDetector().detect_window(df, dates, 5, 49) is None


# ---------------------------------------------------------------- 플랫 베이스
def _flat_closes(low=90.0):
    dip = np.linspace(100, low, 15).tolist() + np.linspace(low, 100, 15).tolist()
    return [95.0] * 5 + dip + [102.0] * 25


def test_flat_base_detected():
    df, dates = _frame(_flat_closes())
    m = FlatBaseDetector().detect_window(df, dates, start_idx=5, end_idx=34)
    assert m is not None and m.pattern_type == "flat_base"
    assert m.pivot_price == 101.0
    assert abs(m.depth - round((101 - 89) / 101 * 100, 2)) < 1e-9
    assert m.broke_out and m.breakout_idx == 35
    assert ms_base_length(m.h_idx, m.end_idx) == 30
    assert [p["role"] for p in m.points] == ["rim", "base", "end"]


def test_flat_base_rejects_deeper_than_15pct():
    df, dates = _frame(_flat_closes(low=80.0))
    assert FlatBaseDetector().detect_window(df, dates, 5, 34) is None


def test_flat_base_rejects_shorter_than_25():
    dip = np.linspace(100, 92, 10).tolist() + np.linspace(92, 100, 10).tolist()
    df, dates = _frame([95.0] * 5 + dip + [102.0] * 10)
    assert FlatBaseDetector().detect_window(df, dates, 5, 24) is None


# ---------------------------------------------------------------- 박스권
def _cons_closes(low=75.0):
    dip = np.linspace(100, low, 15).tolist() + np.linspace(low, 100, 15).tolist()
    return [95.0] * 5 + dip + [103.0] * 25


def test_consolidation_detected():
    df, dates = _frame(_cons_closes())
    m = ConsolidationDetector().detect_window(df, dates, start_idx=5, end_idx=34)
    assert m is not None and m.pattern_type == "consolidation"
    assert m.pivot_price == 101.0 and 15.0 < m.depth <= 50.0
    assert m.broke_out and m.breakout_idx == 35
    assert [p["role"] for p in m.points] == ["rim", "base", "end"]


def test_consolidation_rejects_shallow():
    df, dates = _frame(_cons_closes(low=90.0))  # 깊이 ~12% (플랫 영역)
    assert ConsolidationDetector().detect_window(df, dates, 5, 34) is None


def test_consolidation_rejects_ongoing_decline():
    # 저점이 창 맨 끝이고 회복 없음 → 진행 중 하락
    closes = [95.0] * 5 + np.linspace(100, 70, 35).tolist()
    df, dates = _frame(closes)
    assert ConsolidationDetector().detect_window(df, dates, 5, 39) is None


# ---------------------------------------------------------------- HTF
def test_htf_pivot_is_second_high_not_pole_peak():
    df, dates = _frame(_htf_prices(), hi=1.01, lo=0.99, pct=True)
    m = HighTightFlagDetector().detect_window(df, dates, start_idx=58, end_idx=79)
    assert m is not None and m.pattern_type == "high_tight_flag"
    assert m.h_idx == 58
    assert m.pivot_price == round(float(df["high"].iloc[67]), 4)  # 두 번째 고점
    assert m.pivot_price < float(df["high"].iloc[58])  # 깃대 고점 아님
    assert m.broke_out and m.breakout_idx == 80
    assert ms_base_length(m.h_idx, m.breakout_idx - 1) == 22
    assert 5.0 <= m.depth <= 15.0
    assert [p["role"] for p in m.points] == ["pole", "rim", "pivot", "base", "end"]


def test_htf_rejects_weak_flagpole():
    # 10 → 16(+60%) — 깃대 +100% 미달
    df, dates = _frame(_htf_prices(pole_top=16.0), hi=1.01, lo=0.99, pct=True)
    assert HighTightFlagDetector().detect_window(df, dates, 58, 79) is None


def test_htf_rejects_split_like_jump():
    # 깃대 구간에 하루 +60% 점프(수정주가 미반영 왜곡) → 제외
    p = _htf_prices()
    p = [x if i < 45 else x * 1.6 for i, x in enumerate(p)]
    df, dates = _frame(p, hi=1.01, lo=0.99, pct=True)
    assert HighTightFlagDetector().detect_window(df, dates, 58, 79) is None

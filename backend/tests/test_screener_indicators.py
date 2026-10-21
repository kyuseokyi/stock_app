"""스크리너 지표 — 값 고정과 기존 정의(게임 RSI·차트 배열/매물대·골든크로스)와 같은지."""
import math
import random

import pytest

from apps.collector.screener import indicators as ind
from apps.stock_api.graphql.types import Candle
from apps.stock_api.services import chart
from apps.trading_game.services.indicators import golden_cross_within
from apps.trading_game.services.rsi_service import wilder_rsi


def test_sma_and_std_pop():
    vals = [float(x) for x in range(1, 21)]
    assert ind.sma(vals, 5) == 18.0
    assert ind.sma(vals, 21) is None
    assert ind.std_pop(vals, 20) == pytest.approx(math.sqrt(33.25))  # 1..20 모집단 표준편차
    assert ind.std_pop(vals[:19], 20) is None


def test_rsi14_uses_last_100_closes_of_wilder():
    closes = [100 + (i % 9) * 1.5 - (i % 4) for i in range(150)]
    assert ind.rsi14(closes) == wilder_rsi(closes[-100:], 14)
    assert ind.rsi14([float(x) for x in range(1, 16)]) == 100.0  # 15개(변화 14개)면 계산, 내린 날 없음
    assert ind.rsi14([float(x) for x in range(1, 15)]) is None


def test_chg_pct():
    assert ind.chg_pct([100.0, 110.0]) == pytest.approx(10.0)
    assert ind.chg_pct([110.0]) is None
    assert ind.chg_pct([0.0, 5.0]) is None


def test_vol_ratio():
    assert ind.vol_ratio([100.0] * 20 + [250.0]) == 2.5
    assert ind.vol_ratio([0.0] * 20 + [5.0]) is None  # 직전 평균 0
    assert ind.vol_ratio([100.0] * 20) is None         # 직전 20일 + 당일 = 21개 필요


@pytest.mark.parametrize("closes, expected", [
    ([float(x) for x in range(1, 131)], 1),                        # 계속 오름 → 정배열
    ([float(x) for x in range(130, 0, -1)], -1),                   # 계속 내림 → 역배열
    ([float(x) for x in range(1, 101)], 0),                        # 120일선 계산 불가
    ([100.0 + (5 if i % 2 else -5) for i in range(130)], 0),       # 들쭉날쭉 → 혼합
])
def test_ma_order_code_matches_chart(closes, expected):
    candles = [Candle(date=f"d{i}", open=c, high=c, low=c, close=c, volume=1) for i, c in enumerate(closes)]
    code = {"PERFECT": 1, "REVERSE": -1, "MIXED": 0}[chart.ma_order(candles)]
    assert ind.ma_order_code(closes) == expected == code


def test_prev_high_and_new_high():
    assert ind.prev_high([10.0] * 251 + [11.0]) == 10.0        # 직전 251봉 최고 10 → 당일 11 은 경신
    assert ind.prev_high([10.0] * 250 + [12.0, 11.0]) == 12.0
    assert ind.prev_high([10.0] * 251) is None                  # 252봉 미만
    assert ind.prev_high([99.0] + [10.0] * 251 + [11.0]) == 10.0  # 252봉보다 앞은 보지 않는다


@pytest.mark.parametrize("closes, expected", [
    ([100.0] * 70 + [130.0], 0),            # 오늘 20일선이 60일선 위로
    ([100.0] * 70 + [130.0] * 2, 1),
    ([100.0] * 70 + [130.0] * 3, 2),
    ([100.0] * 70 + [130.0] * 4, None),     # 교차가 3거래일보다 전
    ([100.0] * 60 + [130.0], None),         # 63봉 미만
    ([100.0] * 71, None),                   # 교차 없음(같은 값)
])
def test_gc_days(closes, expected):
    assert ind.gc_days(closes) == expected


def test_gc_days_agrees_with_golden_cross_within():
    rng = random.Random(7)
    for _ in range(50):
        closes, p = [], 100.0
        for _ in range(120):
            p = max(1.0, p + rng.uniform(-3, 3))
            closes.append(p)
        found = ind.gc_days(closes) is not None
        assert found == golden_cross_within(closes, fast=20, slow=60, within=3)


def test_volume_buckets_match_chart_volume_profile():
    rows = [(100 + (i % 7) * 3 + 5, 100 + (i % 7) * 3 - 5, 100 + (i % 7) * 3, 1000 + i * 10) for i in range(30)]
    candles = [Candle(date=f"2026-01-{i + 1:02d}", open=c, high=h, low=lo, close=c, volume=v)
               for i, (h, lo, c, v) in enumerate(rows)]
    mine = ind.volume_buckets([r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows])
    assert mine == [float(b.volume) for b in chart.volume_profile(candles)]


def test_vp_above_pct():
    highs, lows = [200.0] * 120, [100.0] * 120
    closes = [190.0] * 60 + [110.0] * 59 + [150.0]   # 구간 폭 5 → 190 은 18번, 110 은 2번, 150 은 10번 구간
    volumes = [100.0] * 120
    assert ind.vp_above_pct(highs, lows, closes, volumes) == 50.0   # 위쪽 구간(18번) 6000 / 전체 12000
    assert ind.vp_above_pct(highs[1:], lows[1:], closes[1:], volumes[1:]) is None  # 120봉 미만
    flat = [100.0] * 120
    assert ind.vp_above_pct(flat, flat, flat, volumes) == 0.0       # 가격 범위 0
    assert ind.vp_above_pct(highs, lows, closes, [0.0] * 120) is None  # 거래량 0


def test_ratio_per_pbr():
    assert ind.ratio(10000.0, 500.0) == 20.0
    assert ind.ratio(10000.0, 0.0) is None
    assert ind.ratio(10000.0, -10.0) is None   # 적자·자본잠식은 배수 의미 없음
    assert ind.ratio(10000.0, None) is None

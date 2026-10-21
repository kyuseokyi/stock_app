"""스크리너 하루치 조립 — 종목 한 줄 값, 짧은 이력, 건너뛰기·프로필 반영, 종목별 실패 격리."""
import math
from datetime import date, timedelta

import pytest

from apps.collector.screener import compute
from shared.sector_group import NO_SECTOR

START = date(2025, 6, 1)


def _bars(n, last_volume=1_000_000.0, volume=400_000.0):
    """종가 1000 + 10·i(계속 오름), 고가 +5, 저가 -5. 마지막 날만 거래량이 다르다."""
    out = []
    for i in range(n):
        c = 1000.0 + 10 * i
        out.append((START + timedelta(days=i), c + 5, c - 5, c, last_volume if i == n - 1 else volume))
    return out


def test_stock_row_full_history():
    bars = _bars(260)
    as_of = bars[-1][0]
    fin = {"yymm": "202512", "eps": 359.0, "bps": 1795.0, "roe": 12.0, "sales_growth": 5.0, "op_growth": -3.0,
           "debt_ratio": 80.0}
    r = compute.stock_row(as_of, "AAA", "KOSPI", "0013", bars, 1000, fin)
    assert r["date"] == as_of and r["ticker"] == "AAA" and r["market"] == "KOSPI" and r["sector_m"] == "0013"
    assert r["close"] == 3590.0 and r["volume"] == 1_000_000.0
    assert r["chg_1d"] == pytest.approx(3590 / 3580 * 100 - 100)
    assert r["value"] == 3590.0 * 1_000_000           # 거래대금 근사 = 종가 × 거래량
    assert r["mcap"] == 3590.0 * 1000 * 1000           # 종가 × 상장주식수(천 주) × 1000
    assert r["vol_ratio20"] == 2.5
    assert r["rsi14"] == 100.0                          # 내린 날 없음
    assert (r["ma5"], r["ma20"], r["ma50"], r["ma60"], r["ma120"]) == (3570.0, 3495.0, 3345.0, 3295.0, 2995.0)
    assert r["std20"] == pytest.approx(10 * math.sqrt(33.25))
    assert r["ma_order"] == 1
    assert r["high_52w_prev"] == 3585.0 and r["is_new_high"] == 1
    assert r["gc_days"] is None                         # 계속 20일선 > 60일선 — 최근 교차 없음
    assert r["vp_above_pct"] == 0.0                     # 최고가 근처 — 위쪽 매물 없음
    assert (r["roe"], r["eps"], r["sales_growth"], r["op_growth"], r["debt_ratio"]) == (12.0, 359.0, 5.0, -3.0, 80.0)
    assert r["per"] == 10.0 and r["pbr"] == 2.0
    assert r["liquid"] == 1                             # 20일 평균 거래대금 10억 이상·종가 1,000원 이상
    assert set(r) == set(compute.ROW_KEYS)


def test_stock_row_short_history():
    bars = _bars(30, last_volume=400_000.0)
    r = compute.stock_row(bars[-1][0], "BBB", "KOSDAQ", "", bars, None, None)
    assert r["rsi14"] == 100.0 and r["std20"] is not None and r["vol_ratio20"] == 1.0
    assert r["ma60"] is None and r["ma120"] is None and r["ma_order"] == 0
    assert r["gc_days"] is None and r["vp_above_pct"] is None
    assert r["high_52w_prev"] is None and r["is_new_high"] == 0
    assert r["mcap"] is None and r["per"] is None and r["pbr"] is None and r["roe"] is None
    assert r["liquid"] == 0                             # 평균 거래대금 10억 미만


def test_compute_day_skips_and_maps_profile():
    bars = _bars(30)
    as_of = bars[-1][0]
    universe = [("AAA", "에이", "KOSPI"), ("BBB", "비", "KOSDAQ"), ("CCC", "씨", "KOSPI"), ("DDD", "디", "KOSPI")]
    profiles = {"AAA": ("KOSDAQ", "0013", 1000, False), "DDD": ("", NO_SECTOR, None, False)}
    all_bars = {"AAA": bars, "BBB": bars[:-1], "DDD": bars}   # BBB 는 기준일 봉 없음(거래정지 등), CCC 는 일봉 없음
    rows, failed, skipped = compute.compute_day(as_of, universe, profiles, all_bars, {"AAA": {"eps": 100.0}})
    assert (failed, skipped) == (0, 2)                          # BBB(기준일 봉 없음)·CCC(일봉 없음)
    assert [r["ticker"] for r in rows] == ["AAA", "DDD"]
    a, d = rows
    assert a["market"] == "KOSDAQ" and a["sector_m"] == "0013" and a["eps"] == 100.0  # 프로필 시장이 우선
    assert d["market"] == "KOSPI" and d["sector_m"] == ""      # 프로필 시장이 비면 마스터 시장, "0000" 은 업종 없음


def test_compute_day_isolates_bad_ticker(monkeypatch):
    bars = _bars(30)
    as_of = bars[-1][0]
    real = compute.stock_row

    def flaky(as_of_, ticker, *args):
        if ticker == "AAA":
            raise ValueError("bad data")
        return real(as_of_, ticker, *args)

    monkeypatch.setattr(compute, "stock_row", flaky)
    rows, failed, skipped = compute.compute_day(as_of, [("AAA", "에이", "KOSPI"), ("BBB", "비", "KOSPI")], {},
                                                {"AAA": bars, "BBB": bars}, {})
    assert [r["ticker"] for r in rows] == ["BBB"] and (failed, skipped) == (1, 0)

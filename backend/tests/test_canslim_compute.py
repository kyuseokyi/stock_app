"""CANSLIM 하루치 조립 — 가짜 종목·시장으로 행 값(RS 백분위·업종 RS·시장 상태·건너뛰기)."""
from datetime import date, timedelta

import pytest

from apps.collector.canslim import compute as cp
from apps.collector.canslim import rules as r

AS_OF = date(2026, 10, 16)


def _bars(closes, volume=2_000_000.0):
    start = AS_OF - timedelta(days=len(closes) - 1)
    return [(start + timedelta(days=i), c * 1.01, c, volume) for i, c in enumerate(closes)]


def _inputs():
    universe = [("AAA", "강한주", "KOSPI"), ("BBB", "약한주", "KOSPI"), ("CCC", "신규상장", "KOSDAQ"),
                ("DDD", "거래정지", "KOSDAQ")]
    profiles = {"AAA": ("0013", 12), "BBB": ("0013", 12), "CCC": ("1028", 12), "DDD": ("1028", 12)}
    bars = {
        "AAA": _bars([1000.0 + i * 10 for i in range(260)]),     # 꾸준히 상승 → RS 높음·신고가
        "BBB": _bars([5000.0 - i * 5 for i in range(260)]),      # 꾸준히 하락
        "CCC": _bars([2000.0 + i for i in range(80)]),           # 80봉 — RS 부족, N 계산
        "DDD": _bars([3000.0] * 260)[:-1],                       # 기준일 봉 없음 → 건너뜀
    }
    index_bars = {"KOSPI": [(100.0 + i, 1000.0) for i in range(220)],
                  "KOSDAQ": [(300.0 - i, 1000.0) for i in range(220)]}
    investor = {"AAA": [100] * 20, "BBB": [-100] * 20}
    fundamentals = {"AAA": {"Y": [("202212", 100.0, 20.0), ("202312", 130.0, 20.0), ("202412", 170.0, 20.0),
                                  ("202512", 220.0, 21.0)],
                            "Q": [("202506", 50.0), ("202606", 80.0)]}}
    return universe, profiles, bars, index_bars, investor, fundamentals


def test_compute_day_rows_and_markets():
    rows, markets = cp.compute_day(AS_OF, *_inputs(), q_cumulative=False)
    by = {row["ticker"]: row for row in rows}
    assert set(by) == {"AAA", "BBB", "CCC"}  # DDD: 기준일 봉 없음

    a = by["AAA"]
    assert (a["c"], a["a"], a["n"], a["s"], a["i"], a["m"]) == (r.PASS,) * 6
    assert a["l_rs"] == 75 and a["l"] == r.FAIL   # RS 원값 있는 종목 2개 중 상위 → 백분위 75
    assert a["score"] == 80 and a["pass_count"] == 6
    assert a["c_growth"] == pytest.approx(60.0) and a["c_quarter"] == "202606" and a["a_roe"] == 21.0
    assert a["sector_m"] == "0013" and a["market"] == "KOSPI" and a["date"] == AS_OF
    assert a["liquid"] == 1 and a["avg_value_20d"] > 1e9

    b = by["BBB"]
    assert b["l_rs"] == 25 and b["c"] == r.NA and b["a"] == r.NA and b["i"] == r.FAIL and b["n"] == r.FAIL

    c = by["CCC"]
    assert c["l"] == r.NA and c["l_rs"] is None and c["n"] == r.PASS and c["i"] == r.NA
    assert c["m"] == r.FAIL  # KOSDAQ 하락

    assert {m["market"]: m["status"] for m in markets} == {"KOSPI": "상승 추세", "KOSDAQ": "하락"}
    assert all(m["date"] == AS_OF for m in markets)


def test_sector_rs_rank():
    rows, _ = cp.compute_day(AS_OF, *_inputs(), q_cumulative=False)
    by = {row["ticker"]: row for row in rows}
    assert by["AAA"]["sector_rs_rank"] == 1 and by["AAA"]["sector_rs_count"] == 1  # RS 있는 업종은 0013 하나
    assert by["CCC"]["sector_rs_rank"] is None


def test_c_pending_when_cumulative_unknown():
    rows, _ = cp.compute_day(AS_OF, *_inputs(), q_cumulative=None)
    a = next(row for row in rows if row["ticker"] == "AAA")
    assert a["c"] == r.PENDING and a["score"] == 60


def test_bad_ticker_is_skipped(monkeypatch):
    real = cp.rules.eval_s

    def boom(closes, volumes):
        if closes[-1] == 1000.0 + 259 * 10:
            raise ValueError("broken")
        return real(closes, volumes)

    monkeypatch.setattr(cp.rules, "eval_s", boom)
    rows, _ = cp.compute_day(AS_OF, *_inputs(), q_cumulative=False)
    assert {row["ticker"] for row in rows} == {"BBB", "CCC"}

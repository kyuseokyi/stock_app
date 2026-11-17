"""apps.collector.kiwoom.normalize — 키움 원시 문자열 → KIS 일봉과 같은 모양."""

from __future__ import annotations

from datetime import date

import pytest

from apps.collector.kiwoom.normalize import daily_row, stock_suffix, to_int, to_price


@pytest.mark.parametrize("raw,expected", [
    ("+600", 600), ("-600", -600), ("1,234", 1234), (" 70100 ", 70100), ("", 0), (None, 0),
    ("   ", 0), ("0000000123759593", 123759593), ("-", 0), ("+", 0), ("+12600.00", 12600),
])
def test_to_int(raw, expected):
    assert to_int(raw) == expected


def test_to_price_drops_sign():
    assert to_price("-69500") == 69500
    assert to_price("+70,100") == 70100
    assert to_price("") == 0


def test_daily_row_matches_kis_shape():
    raw = {"dt": "20250908", "open_pric": "+69800", "high_pric": "70500", "low_pric": "-69600",
           "cur_prc": "-70100", "trde_qty": "9263135", "trde_prica": "648525", "pred_pre": "+600"}
    row = daily_row(raw)
    # KIS fetcher._to_ohlcv 와 같은 키·타입(date 객체, 가격 float, 거래량 int) + 거래대금(원)
    assert row == {
        "date": date(2025, 9, 8), "open": 69800.0, "high": 70500.0, "low": 69600.0,
        "close": 70100.0, "volume": 9263135, "trading_value": 648525 * 1_000_000,
    }
    assert isinstance(row["open"], float) and isinstance(row["volume"], int)


def test_daily_row_empty_values():
    row = daily_row({"dt": "20260805", "open_pric": "", "high_pric": "", "low_pric": "", "cur_prc": "",
                     "trde_qty": "", "trde_prica": ""})
    assert row["date"] == date(2026, 8, 5)
    assert row["close"] == 0.0 and row["volume"] == 0 and row["trading_value"] == 0


def test_stock_suffix():
    assert stock_suffix("005930", "Y") == "005930_AL"
    assert stock_suffix("293490", "N") == "293490"
    assert stock_suffix("293490", "") == "293490"
    assert stock_suffix("005930", "y") == "005930_AL"


# ------------------------------------------------------------------ ka10058
from apps.collector.kiwoom import normalize as kn  # noqa: E402


@pytest.mark.parametrize("raw, want", [
    ("005930", "005930"), ("005930_AL", "005930"), ("A005930", "005930"), (" 0001a0_NX ", "0001A0"),
    ("", None), ("12345", None), (None, None),
])
def test_plain_ticker(raw, want):
    assert kn.plain_ticker(raw) == want


def test_investor_flow_row_converts_unit_and_strips_suffix():
    # 명세 response_example 1행 — 4464주 × 추정평균가 57056 ≈ 2.547억 ≈ 25467 × 1만
    raw = {"stk_cd": "005930_AL", "stk_nm": "삼성전자", "netslmt_qty": "+4464", "netslmt_amt": "+25467",
           "prsm_avg_pric": "57056"}
    r = kn.investor_flow_row(raw)
    assert r["ticker"] == "005930" and r["name"] == "삼성전자"
    assert r["net_amount"] == 25467 * kn.KIWOOM_FLOW_AMT_TO_WON == 254_670_000
    assert r["raw_amt"] == 25467 and r["qty"] == 4464 and r["avg_price"] == 57056
    assert kn.investor_flow_row({"stk_cd": "x", "netslmt_amt": "1"}) is None


def test_investor_flow_row_keeps_negative_sign():
    assert kn.investor_flow_row({"stk_cd": "000660", "stk_nm": "n", "netslmt_amt": "-30"})["net_amount"] == -300_000


def test_implied_unit_matches_spec_example():
    rows = [kn.investor_flow_row(x) for x in (
        {"stk_cd": "005930", "netslmt_qty": "+4464", "netslmt_amt": "+25467", "prsm_avg_pric": "57056"},
        {"stk_cd": "005930", "netslmt_qty": "+12", "netslmt_amt": "+106", "prsm_avg_pric": "86658"},
        {"stk_cd": "005930", "netslmt_qty": "+46", "netslmt_amt": "+75", "prsm_avg_pric": "16320"},
    )]
    assert kn.implied_amt_unit(rows) == 10_000
    assert kn.implied_amt_unit([{"raw_amt": 0, "qty": 0, "avg_price": 0}]) is None

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

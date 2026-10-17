"""국내 증시 거래일 달력 — 주말·공휴일·대체공휴일·KRX 연말 휴장·수동 휴장일."""
from __future__ import annotations

from datetime import date, datetime

import pytest

from apps.trading_game.services import market_calendar as cal
from apps.trading_game.services import market_clock


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)


@pytest.mark.parametrize("d", [
    date(2026, 10, 17), date(2026, 10, 18),                     # 토·일
    date(2026, 2, 16), date(2026, 2, 17), date(2026, 2, 18),    # 설 연휴
    date(2026, 3, 2),                                           # 삼일절(일) 대체공휴일
    date(2026, 5, 1),                                           # 노동절
    date(2026, 5, 25),                                          # 부처님오신날(일) 대체공휴일
    date(2026, 6, 3),                                           # 지방선거일
    date(2026, 9, 24), date(2026, 9, 25),                       # 추석 연휴
    date(2026, 10, 5),                                          # 개천절(토) 대체공휴일
    date(2026, 12, 25),                                         # 성탄절
    date(2026, 12, 31),                                         # KRX 연말 휴장(목)
    date(2027, 2, 9),                                           # 설 대체공휴일
])
def test_closed_days(d):
    assert cal.is_trading_day(d) is False


@pytest.mark.parametrize("d", [date(2026, 10, 16), date(2026, 10, 19), date(2026, 12, 30), date(2027, 1, 4)])
def test_open_weekdays(d):
    assert cal.is_trading_day(d) is True


def test_year_end_closing_moves_to_friday_when_weekend():
    assert cal.krx_year_end_closing(2026) == date(2026, 12, 31)   # 목
    assert cal.krx_year_end_closing(2027) == date(2027, 12, 31)   # 금
    assert cal.krx_year_end_closing(2028) == date(2028, 12, 29)   # 12/31 일 → 12/29 금
    assert cal.is_trading_day(date(2028, 12, 29)) is False


def test_manual_holidays_env_and_bad_entries_ignored(monkeypatch, caplog):
    monkeypatch.setenv("MARKET_HOLIDAYS", "2026-10-16, oops ,2026-10-19")
    assert cal.is_trading_day(date(2026, 10, 16)) is False
    assert cal.is_trading_day(date(2026, 10, 19)) is False
    assert cal.is_trading_day(date(2026, 10, 20)) is True
    assert "oops" in caplog.text


def test_trading_days_all_overrides(monkeypatch):
    monkeypatch.setenv("TRADING_DAYS", "all")
    assert cal.is_trading_day(date(2026, 10, 17)) is True
    assert cal.is_trading_day(date(2026, 12, 31)) is True


def test_in_trading_window_respects_calendar():
    w = market_clock.parse_windows(None)
    at = lambda y, m, d, h=10: datetime(y, m, d, h, 0, tzinfo=market_clock.KST)  # noqa: E731
    assert market_clock.in_trading_window(at(2026, 10, 16), w) is True    # 금 10:00
    assert market_clock.in_trading_window(at(2026, 10, 17), w) is False   # 토 10:00
    assert market_clock.in_trading_window(at(2026, 10, 5), w) is False    # 대체공휴일
    assert market_clock.in_trading_window(at(2026, 10, 16, 21), w) is False  # 평일 장 밖

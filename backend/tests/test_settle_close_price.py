"""정산 종가 선택 — 종료일 당일 또는 그 이전 가장 최근 거래일 종가."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from apps.collector.tasks import settle_season as ss
from apps.stock_api.services.chart import Candle

KST = timezone(timedelta(hours=9))


def _c(d: str, close: float) -> Candle:
    return Candle(date=d, open=close, high=close, low=close, close=close, volume=1)


@pytest.fixture
def ch(monkeypatch):
    """get_candles / 날짜별 전체 행 수를 대역으로."""
    state = {"candles": [], "rows": {}}
    monkeypatch.setattr(ss, "get_candles", lambda t, s, e: [c for c in state["candles"] if s <= c.date <= e] or None)
    monkeypatch.setattr(ss, "_market_rows_on", lambda d: state["rows"].get(d, 0))
    return state


def _end(y, m, d):
    return datetime(y, m, d, 20, 0, tzinfo=KST)


def test_same_day_close(ch):
    ch["candles"] = [_c("2026-10-29", 100), _c("2026-10-30", 110)]
    end = _end(2026, 10, 30)  # 금
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(minutes=40)) == Decimal("110")


def test_weekend_end_uses_last_trading_day(ch):
    ch["candles"] = [_c("2026-10-29", 100), _c("2026-10-30", 110)]
    end = _end(2026, 10, 31)  # 토
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(minutes=40)) == Decimal("110")


def test_candle_after_end_date_ignored(ch):
    ch["candles"] = [_c("2026-10-30", 110), _c("2026-11-02", 999)]
    end = _end(2026, 10, 31)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(days=3)) == Decimal("110")


def test_weekday_missing_same_day_holds(ch):
    ch["candles"] = [_c("2026-10-29", 100)]
    end = _end(2026, 10, 30)  # 금 — 당일 봉 없음(수집 전/실패)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(minutes=40)) is None


def test_weekday_holiday_settles_next_day(ch):
    # 2026-12-31(목) 휴장: 다음 날 실행에서 전 종목 0행이면 휴장으로 보고 직전 거래일 종가
    ch["candles"] = [_c("2026-12-30", 120)]
    end = _end(2026, 12, 31)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(minutes=40)) is None  # 당일은 보류
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(days=1)) == Decimal("120")


def test_weekday_market_open_but_ticker_missing_holds(ch):
    ch["candles"] = [_c("2026-10-29", 100)]
    ch["rows"] = {date(2026, 10, 30): 3700}  # 다른 종목은 수집됨 → 이 종목 수집 누락
    end = _end(2026, 10, 30)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(days=1)) is None


def test_weekday_fallback_after_three_days(ch):
    ch["candles"] = [_c("2026-10-29", 100)]
    ch["rows"] = {date(2026, 10, 30): 3700}
    end = _end(2026, 10, 30)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(days=3)) == Decimal("100")


def test_no_candles_holds(ch):
    end = _end(2026, 10, 31)
    assert ss.clickhouse_close_price("005930", end, now=end + timedelta(days=5)) is None

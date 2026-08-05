"""국내 일봉 수집 Celery 태스크.

collect_daily_ohlcv(ticker): KIS 겹침창(today-30d~+2d) 수집 → MA 계산 → ClickHouse 멱등 적재.
Phase 1 (a) 수직 슬라이스: 수동 트리거로 1종목 검증. (전종목/beat 는 다음 슬라이스)
"""

from __future__ import annotations

from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import enrich_with_ma
from apps.collector.kis.fetcher import fetch_domestic_daily
from apps.collector.repositories.clickhouse_ohlcv import count_ticker, upsert_daily_prices

_LOOKBACK_DAYS = 30  # 겹침 재수집(정정/누락 흡수)
_LOOKAHEAD_DAYS = 2


@celery_app.task(name="collector.collect_daily_ohlcv")
def collect_daily_ohlcv(
    ticker: str, start: str | None = None, end: str | None = None
) -> dict:
    today = date.today()
    start_str = start or (today - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end_str = end or (today + timedelta(days=_LOOKAHEAD_DAYS)).strftime("%Y%m%d")

    ohlcv = fetch_domestic_daily(ticker, start_str, end_str)
    enriched = enrich_with_ma(ohlcv)
    inserted = upsert_daily_prices(ticker, enriched)
    return {
        "ticker": ticker,
        "range": [start_str, end_str],
        "inserted": inserted,
        "total_after": count_ticker(ticker),
    }

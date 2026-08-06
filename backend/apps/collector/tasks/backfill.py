"""국내 일봉 백필(장기 히스토리) Celery 태스크.

backfill_domestic_daily(ticker, months): 과거 N개월을 청킹 수집 → 전체 시계열에
MA를 한 번에 계산 → ClickHouse 멱등 적재.

⚠️ 청크마다 MA를 따로 계산하면 각 청크 앞부분 MA가 깨지고 MA120이 안 채워진다.
   반드시 전체 시계열을 이어붙인 뒤(enrich_with_ma) 한 번만 계산한다.

MA120 은 표시 구간 앞쪽에 120 거래일이 더 있어야 유효하다. 1년 백필이면
가장 최근 ~8개월 구간의 MA120 이 채워진다(그 이전은 lookback 부족으로 None).
"""

from __future__ import annotations

from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import enrich_with_ma
from apps.collector.kis.fetcher import fetch_domestic_daily_range
from apps.collector.repositories.clickhouse_ohlcv import count_ticker, upsert_daily_prices


@celery_app.task(name="collector.backfill_domestic_daily")
def backfill_domestic_daily(
    ticker: str, months: int = 14, end: str | None = None
) -> dict:
    end_d = date(int(end[:4]), int(end[4:6]), int(end[6:8])) if end else date.today()
    start_d = end_d - timedelta(days=int(months) * 31)
    start_str = start_d.strftime("%Y%m%d")
    end_str = end_d.strftime("%Y%m%d")

    ohlcv = fetch_domestic_daily_range(ticker, start_str, end_str)
    enriched = enrich_with_ma(ohlcv)  # 전체 시계열에 한 번만 계산(MA120 정합)
    inserted = upsert_daily_prices(ticker, enriched)

    ma120_filled = sum(1 for r in enriched if r.get("ma120") is not None)
    return {
        "ticker": ticker,
        "range": [start_str, end_str],
        "fetched": len(ohlcv),
        "inserted": inserted,
        "ma120_filled": ma120_filled,
        "total_after": count_ticker(ticker),
    }

"""전종목 수집/백필 Celery 태스크.

- collect_all_daily : 전종목 일봉 겹침창 수집(매일 장 마감 후 beat 예정)
- backfill_all_daily: 전종목 장기 백필(청킹)

공통: 마스터 로드 → 레이트리밋(초당 제한) → 종목별 try/except 실패격리 → 진행로그.
단일 종목 프리미티브(fetch/enrich/upsert)를 재사용하며, KISClient 를 공유해 토큰 캐시를 재활용한다.
"""

from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import enrich_with_ma
from apps.collector.kis.client import KISClient
from apps.collector.kis.fetcher import fetch_domestic_daily, fetch_domestic_daily_range
from apps.collector.rate_limit import RateLimiter
from apps.collector.repositories.clickhouse_ohlcv import upsert_daily_prices
from apps.collector.stock_master import load_domestic_tickers

logger = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30
_LOOKAHEAD_DAYS = 2
_DEFAULT_RATE = float(os.getenv("KIS_RATE_PER_SEC", "8"))  # 실전 ~20/s → 보수적 8/s
_PROGRESS_EVERY = 50


def _run_universe(collect_one, limit, source, rate_per_sec) -> dict:
    """공통 루프: 마스터 로드 → 레이트리밋 → 종목별 실패격리 → 집계."""
    tickers = load_domestic_tickers(source)
    if limit:
        tickers = tickers[: int(limit)]
    rate = rate_per_sec if rate_per_sec is not None else _DEFAULT_RATE
    limiter = RateLimiter(rate)
    client = KISClient()  # 토큰 캐시 공유

    total = len(tickers)
    ok = 0
    inserted_sum = 0
    failed: list[dict] = []
    logger.info("전종목 작업 시작: %d종목 (rate=%s/s)", total, rate)

    for i, s in enumerate(tickers, 1):
        try:
            limiter.acquire()
            inserted_sum += collect_one(s.ticker, client)
            ok += 1
        except Exception as e:  # 한 종목 실패가 전체를 막지 않도록 격리
            failed.append({"ticker": s.ticker, "name": s.name, "error": str(e)[:200]})
            logger.warning("수집 실패 %s(%s): %s", s.ticker, s.name, str(e)[:120])
        if i % _PROGRESS_EVERY == 0:
            logger.info("진행 %d/%d (성공 %d, 실패 %d)", i, total, ok, len(failed))

    return {
        "total": total,
        "ok": ok,
        "failed_count": len(failed),
        "inserted": inserted_sum,
        "failed_sample": failed[:30],
    }


def _collect_daily_one(ticker: str, client: KISClient) -> int:
    today = date.today()
    start = (today - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end = (today + timedelta(days=_LOOKAHEAD_DAYS)).strftime("%Y%m%d")
    ohlcv = fetch_domestic_daily(ticker, start, end, client=client)
    return upsert_daily_prices(ticker, enrich_with_ma(ohlcv))


@celery_app.task(name="collector.collect_all_daily")
def collect_all_daily(
    limit: int | None = None, source: str | None = None, rate_per_sec: float | None = None
) -> dict:
    """전종목 일봉 겹침창(today-30d~+2d) 수집."""
    return _run_universe(_collect_daily_one, limit, source, rate_per_sec)


@celery_app.task(name="collector.backfill_all_daily")
def backfill_all_daily(
    months: int = 14,
    limit: int | None = None,
    source: str | None = None,
    rate_per_sec: float | None = None,
) -> dict:
    """전종목 장기 백필(청킹). MA 는 종목별 전체 시계열에 한 번만 계산."""
    def _backfill_one(ticker: str, client: KISClient) -> int:
        today = date.today()
        start = (today - timedelta(days=int(months) * 31)).strftime("%Y%m%d")
        end = today.strftime("%Y%m%d")
        ohlcv = fetch_domestic_daily_range(ticker, start, end, client=client)
        return upsert_daily_prices(ticker, enrich_with_ma(ohlcv))

    return _run_universe(_backfill_one, limit, source, rate_per_sec)

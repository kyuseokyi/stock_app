"""국내 일봉 수집 Celery 태스크.

collect_daily_ohlcv(ticker): KIS 겹침창(today-30d~+2d) 수집 → MA 계산 → ClickHouse 멱등 적재.
Phase 1 (a) 수직 슬라이스: 수동 트리거로 1종목 검증. (전종목/beat 는 다음 슬라이스)
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import HISTORY_BARS, enrich_with_ma
from apps.collector.kis.fetcher import fetch_domestic_daily
from apps.collector.repositories.clickhouse_ohlcv import count_ticker, load_closes_before, upsert_daily_prices

logger = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30  # 겹침 재수집(정정/누락 흡수)
_LOOKAHEAD_DAYS = 2


def enrich_overlap_window(ticker: str, ohlcv: list[dict]) -> list[dict]:
    """겹침창(30일) 수집분에 MA 계산 — 직전 종가를 CH 에서 읽어 앞에 이어 붙인다.

    짧은 창만으로 계산하면 ma50/120(과 창 앞부분 ma20)이 None 이 되어, 백필이 넣어 둔 값을
    ReplacingMergeTree 가 None 으로 덮어쓴다. CH 조회 실패는 수집을 막지 않고 기존 방식으로.
    """
    if not ohlcv:
        return []
    try:
        history = load_closes_before(ticker, ohlcv[0]["date"], HISTORY_BARS)
    except Exception as e:  # noqa: BLE001
        logger.warning("MA 앞부분 종가 조회 실패 %s — 수집 창만으로 계산: %s", ticker, str(e)[:160])
        history = None
    return enrich_with_ma(ohlcv, history)


@celery_app.task(name="collector.collect_daily_ohlcv")
def collect_daily_ohlcv(
    ticker: str, start: str | None = None, end: str | None = None
) -> dict:
    today = date.today()
    start_str = start or (today - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end_str = end or (today + timedelta(days=_LOOKAHEAD_DAYS)).strftime("%Y%m%d")

    ohlcv = fetch_domestic_daily(ticker, start_str, end_str)
    enriched = enrich_overlap_window(ticker, ohlcv)
    inserted = upsert_daily_prices(ticker, enriched)
    return {
        "ticker": ticker,
        "range": [start_str, end_str],
        "inserted": inserted,
        "total_after": count_ticker(ticker),
    }

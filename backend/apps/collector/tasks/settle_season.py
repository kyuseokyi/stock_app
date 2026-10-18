"""시즌 정산 Celery 태스크(매일 20:40 — 종료일 도래 시 정산)."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import redis.asyncio as aioredis

from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.stock_api.services.clickhouse_source import get_candles
from apps.trading_game.services import market_calendar, settlement

log = logging.getLogger("trading_game.settle_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


_KST = timezone(timedelta(hours=9))


_FALLBACK_AFTER = timedelta(days=3)


def _market_rows_on(d: date) -> int:
    """그날 전 종목 일봉 행 수(0 = 휴장 또는 아직 미수집). CH 장애 시 -1(판단 불가 → 보류)."""
    try:
        return int(get_client().query(
            f"SELECT count() FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE date = %(d)s",
            parameters={"d": d.isoformat()},
        ).result_rows[0][0])
    except Exception:  # noqa: BLE001
        return -1


def clickhouse_close_price(ticker: str, end_at: datetime, now: datetime | None = None) -> Decimal | None:
    """시즌 종료일(KST) 당일 또는 그 이전 가장 최근 거래일 종가. None 이면 정산 보류(다음 실행 재시도).

    - 주말·휴장일 종료(거래일 달력 — 공휴일·대체공휴일·KRX 연말 휴장·MARKET_HOLIDAYS): 직전 거래일 종가.
    - 평일 종료인데 당일 봉 없음: 20:30 수집이 덜 끝났거나 실패했을 수 있어 보류.
      다음 날 이후 실행에서 전 종목이 0행이면 휴장(예: 12/31)으로 보고 직전 거래일 종가.
      그래도 판단이 안 되면 종료 3일 뒤부터 있는 종가로 정산(최후 수단).
    """
    now = now or datetime.now(timezone.utc)
    end_date = end_at.astimezone(_KST).date()
    candles = get_candles(ticker, (end_date - timedelta(days=10)).isoformat(), end_date.isoformat())
    usable = [c for c in (candles or []) if str(c.date)[:10] <= end_date.isoformat()]
    if not usable:
        return None
    last = usable[-1]
    close = Decimal(str(last.close))
    if str(last.date)[:10] == end_date.isoformat() or not market_calendar.is_trading_day(end_date):
        return close
    if now.astimezone(_KST).date() > end_date and _market_rows_on(end_date) == 0:
        return close  # 평일 휴장
    if now >= end_at + _FALLBACK_AFTER:
        log.warning("정산 종가 폴백 — %s 당일 봉 없음, %s 종가 사용(ticker=%s)", end_date, last.date, ticker)
        return close
    return None


async def _run() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await settlement.settle_due_season(db, redis, clickhouse_close_price)
    finally:
        await redis.aclose()
        await engine.dispose()


@celery_app.task(name="settle_trading_season")
def settle_trading_season() -> dict | None:
    result = asyncio.run(_run())
    log.info("시즌 정산 결과: %s", result)
    return result

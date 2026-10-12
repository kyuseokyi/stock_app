"""시즌 정산 Celery 태스크(매일 20:40 — 말일 도래 시 정산)."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, timedelta
from decimal import Decimal

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal
from apps.collector.celery_app import celery_app
from apps.stock_api.services.clickhouse_source import get_candles
from apps.trading_game.services import settlement

log = logging.getLogger("trading_game.settle_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def clickhouse_close_price(ticker: str) -> Decimal | None:
    """최근 7일 범위의 마지막 종가(FINAL) → Decimal. 없으면 None."""
    end = date.today()
    start = end - timedelta(days=7)
    candles = get_candles(ticker, start.isoformat(), end.isoformat())
    if not candles:
        return None
    return Decimal(str(candles[-1].close))


async def _run() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await settlement.settle_due_season(db, redis, clickhouse_close_price)
    finally:
        await redis.aclose()


@celery_app.task(name="settle_trading_season")
def settle_trading_season() -> dict | None:
    result = asyncio.run(_run())
    log.info("시즌 정산 결과: %s", result)
    return result

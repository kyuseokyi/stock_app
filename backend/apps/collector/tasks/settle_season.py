"""시즌 정산 Celery 태스크(매일 20:40 — 말일 도래 시 정산)."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.stock_api.services.clickhouse_source import get_candles
from apps.trading_game.services import settlement

log = logging.getLogger("trading_game.settle_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


_KST = timezone(timedelta(hours=9))


def clickhouse_close_price(ticker: str) -> Decimal | None:
    """당일(KST) 종가(FINAL)만 반환. 수집 실패 등으로 당일 종가가 없으면 None(정산 보류)."""
    today = datetime.now(_KST).date()
    candles = get_candles(ticker, (today - timedelta(days=7)).isoformat(), today.isoformat())
    if not candles:
        return None
    last = candles[-1]
    if str(last.date)[:10] != today.isoformat():  # 당일 종가가 아니면 보류
        return None
    return Decimal(str(last.close))


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

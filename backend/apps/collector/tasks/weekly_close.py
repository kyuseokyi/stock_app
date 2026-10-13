"""주간 랭킹 마감 Celery 태스크(매주 월 08:50 KST — 지난주 Top 10 기록·1~3위 보상)."""
from __future__ import annotations

import asyncio
import logging
import os

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.trading_game.services import weekly_service

log = logging.getLogger("trading_game.weekly_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def _run() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await weekly_service.close_previous_week(db, redis)
    finally:
        await redis.aclose()
        await engine.dispose()


@celery_app.task(name="close_trading_week")
def close_trading_week() -> dict | None:
    result = asyncio.run(_run())
    log.info("주간 마감 결과: %s", result)
    return result

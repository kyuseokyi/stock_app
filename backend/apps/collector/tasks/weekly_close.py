"""주간·월간 랭킹 마감 Celery 태스크.

- 주간: 매주 월 08:50 KST — 지난주 Top 10 기록·1~3위 보상
- 월간: 매월 1일 08:55 KST — 분기 시즌의 지난달 Top 10 기록·1~3위 보상
"""
from __future__ import annotations

import asyncio
import logging
import os

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.trading_game.services import monthly_service, weekly_service

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


# ---------------------------------------------------------------- 월간(분기 시즌 전용)
async def _run_month() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await monthly_service.close_previous_month(db, redis)
    finally:
        await redis.aclose()
        await engine.dispose()


@celery_app.task(name="close_trading_month")
def close_trading_month() -> dict | None:
    """매월 1일 08:55 KST — 분기 시즌의 지난달 Top 10 기록·1~3위 보상(월간 시즌이면 None)."""
    result = asyncio.run(_run_month())
    log.info("월간 마감 결과: %s", result)
    return result

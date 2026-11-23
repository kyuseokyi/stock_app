"""교육용 합성 종가 게임 일일 정산 Celery 태스크 — 평일 20:00 KST(beat: edu-game-advance-day).

새 가상 일봉 1개 생성 + 전 계좌 손절·익절·종가 평가(edu_game_service.advance_day_and_settle, 한 트랜잭션).
- 오늘(KST) 이미 진행했으면 건너뛴다(관리자 advance-day 로 낮에 진행한 날 포함).
- EDU_DAILY_GAME 플래그가 꺼져 있으면 진행하지 않는다(시즌이 멈춘 채로 보존).
- PostgreSQL 만 쓰므로 MARKET_DATA_SOURCE=prod_readonly(개발 서버)에서도 그대로 돈다.
"""
from __future__ import annotations

import asyncio
import logging
import os

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.trading_game.services import edu_game_service, feature_flag_service

log = logging.getLogger("trading_game.edu_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def run_once(db, redis) -> dict:
    if not await feature_flag_service.is_enabled(db, redis, edu_game_service.FLAG):
        return {"status": "disabled"}
    return await edu_game_service.advance_day_and_settle(db, force=False)


async def _run() -> dict:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await run_once(db, redis)
    finally:
        await redis.aclose()
        await engine.dispose()


@celery_app.task(name="edu_game_advance_day")
def edu_game_advance_day() -> dict:
    result = asyncio.run(_run())
    log.info("교육 게임 일일 정산 결과: %s", result)
    return result

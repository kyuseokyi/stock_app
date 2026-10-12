"""trading_game 공용 의존성 — Redis 클라이언트(프로세스 싱글턴) + 게이트 상수."""
from __future__ import annotations

import os

import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STALE_SECONDS = int(os.getenv("STALE_SECONDS", "10"))

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis

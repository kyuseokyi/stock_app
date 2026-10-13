"""auth 공용 의존성 — Redis 클라이언트(프로세스 싱글턴, REDIS_URL).

회원 탈퇴 시 게임 랭킹 키 정리에 쓴다. 테스트는 dependency_overrides 로 fakeredis 를 넣는다.
"""
from __future__ import annotations

import os

import redis.asyncio as aioredis

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
    return _redis

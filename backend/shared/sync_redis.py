"""동기 Redis 클라이언트 — 프로세스당 1개를 처음 쓸 때 만든다(celery prefork 는 포크 뒤 자식에서 생성).

stock_api 관리자 기능(데이터 현황·수동 실행)과 collector 파이프라인 기록이 같이 쓴다.
짧은 타임아웃 — Redis 가 죽어도 관리자 화면·파이프라인이 오래 붙잡히지 않게.
"""
from __future__ import annotations

import os

import redis

_client: redis.Redis | None = None


def get_sync_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True, socket_timeout=3, socket_connect_timeout=3,
        )
    return _client

"""실시간 알림 이벤트 pub/sub (Redis 기반).

웹 클라이언트용 SSE 스트림에 이벤트를 전달하기 위해 Redis pub/sub 채널을 쓴다.
새 글 작성 등 이벤트가 발생하면 채널에 publish 하고, SSE 엔드포인트는 이 채널을
subscribe 하여 연결된 브라우저로 즉시 흘려보낸다. (다중 프로세스에서도 동작)
"""

from __future__ import annotations

import json
import os

from redis.asyncio import Redis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
NOTIFICATION_CHANNEL = "notifications"

# 앱 프로세스당 하나의 Redis 클라이언트 재사용
_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def publish_event(event: dict) -> None:
    """알림 이벤트(JSON 직렬화 가능 dict)를 채널에 발행한다."""
    await get_redis().publish(NOTIFICATION_CHANNEL, json.dumps(event, ensure_ascii=False))

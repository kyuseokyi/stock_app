"""Redis Pub/Sub 틱 발행기(async). 채널: stock:tick:{ticker}."""
from __future__ import annotations

import json

import redis.asyncio as aioredis


class TickPublisher:
    def __init__(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=True)

    async def publish(self, tick: dict) -> int:
        """tick 을 JSON 직렬화해 stock:tick:{ticker} 로 PUBLISH. 수신 구독자 수 반환."""
        channel = f"stock:tick:{tick['ticker']}"
        return await self._redis.publish(channel, json.dumps(tick, ensure_ascii=False))

    async def close(self) -> None:
        await self._redis.aclose()

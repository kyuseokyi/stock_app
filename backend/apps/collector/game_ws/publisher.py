"""Redis Pub/Sub 틱 발행기(async).

- 채널 stock:tick:{ticker} 로 PUBLISH (Phase 2, 휘발성 실시간 중계)
- 키 stock:latest:{ticker} 에 SET (Phase 3, 주문 진입가용 최신가 스냅샷, TTL 120s)
  PUBLISH 와 동일 파이프라인에서 함께 수행(단일 writer, additive).
"""
from __future__ import annotations

import json
import time

import redis.asyncio as aioredis

LATEST_TTL_SECONDS = 120


def build_latest_payload(tick: dict) -> str:
    """stock:latest 에 저장할 {price, ts(epoch seconds)} JSON."""
    return json.dumps({"price": tick["price"], "ts": time.time()})


class TickPublisher:
    def __init__(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=True)

    async def publish(self, tick: dict) -> int:
        """tick 을 stock:tick:{ticker} 로 PUBLISH + stock:latest:{ticker} SET(파이프라인)."""
        ticker = tick["ticker"]
        pipe = self._redis.pipeline()
        pipe.publish(f"stock:tick:{ticker}", json.dumps(tick, ensure_ascii=False))
        pipe.set(f"stock:latest:{ticker}", build_latest_payload(tick), ex=LATEST_TTL_SECONDS)
        results = await pipe.execute()
        return int(results[0])  # 수신 구독자 수

    @property
    def redis(self):
        """같은 연결로 장운영 상태(market_status)를 저장·발행한다."""
        return self._redis

    async def close(self) -> None:
        await self._redis.aclose()

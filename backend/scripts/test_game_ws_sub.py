"""stock:tick:* 채널을 구독해 수신 틱을 콘솔에 출력(수동 검증).

실행: uv run python -m scripts.test_game_ws_sub   (Ctrl+C 로 종료)
"""
from __future__ import annotations

import asyncio
import os

import redis.asyncio as aioredis


async def main() -> None:
    r = aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.psubscribe("stock:tick:*")
    print("구독: stock:tick:*  (Ctrl+C 종료)")
    try:
        async for msg in pubsub.listen():
            if msg.get("type") == "pmessage":
                print(msg["channel"], msg["data"])
    finally:
        await pubsub.aclose()
        await r.aclose()


if __name__ == "__main__":
    asyncio.run(main())

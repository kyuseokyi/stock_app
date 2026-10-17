"""공개 랭킹 목록(Top 100) 응답 단기 캐시(Redis).

랭킹 창이 열려 있는 동안 클라이언트가 주기적으로 다시 불러온다 — 보는 사람이 늘어도 PG 조회(닉네임·계좌 join)는
TTL 마다 한 번으로 묶는다. 순위 자체(Redis ZSET)는 틱마다 갱신되므로 몇 초 늦는 정도는 체감되지 않는다.
Redis 오류는 캐시 없이 원래 조회로(fail-open). 예외(404 등)는 캐시하지 않는다.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

log = logging.getLogger(__name__)

BOARD_CACHE_TTL_SEC = 5


def cache_key(kind: str, season_id: int) -> str:
    return f"game:cache:board:{kind}:{season_id}"


async def cached(redis, key: str, build: Callable[[], Awaitable[Any]], ttl: int | None = None) -> Any:
    ttl = BOARD_CACHE_TTL_SEC if ttl is None else ttl
    if ttl <= 0:
        return await build()
    try:
        hit = await redis.get(key)
        if hit is not None:
            return json.loads(hit)
    except Exception:  # noqa: BLE001
        log.warning("랭킹 캐시 조회 실패 key=%s", key, exc_info=True)
    value = await build()
    try:
        await redis.set(key, json.dumps(value), ex=ttl)
    except Exception:  # noqa: BLE001
        log.warning("랭킹 캐시 저장 실패 key=%s", key, exc_info=True)
    return value

"""Redis 저장소 — state nonce 1회 사용 + 일회용 교환 코드(60초).

라우터는 `Depends(get_social_store)` 로 받으므로 테스트는 fakeredis 로 교체한다.
"""

from __future__ import annotations

import os
import secrets

import redis.asyncio as aioredis

NONCE_TTL_SECONDS = 600
EXCHANGE_CODE_TTL_SECONDS = 60

_NONCE_KEY = "auth:social:nonce:{}"
_CODE_KEY = "auth:social:code:{}"


class SocialStore:
    def __init__(self, redis: aioredis.Redis):
        self._redis = redis

    async def use_nonce(self, nonce: str) -> bool:
        """처음 쓰는 nonce 면 True, 이미 쓴 nonce 면 False(SET NX)."""
        ok = await self._redis.set(_NONCE_KEY.format(nonce), "1", nx=True, ex=NONCE_TTL_SECONDS)
        return bool(ok)

    async def issue_exchange_code(self, user_id: int) -> str:
        code = secrets.token_urlsafe(32)
        await self._redis.set(_CODE_KEY.format(code), str(user_id), ex=EXCHANGE_CODE_TTL_SECONDS)
        return code

    async def consume_exchange_code(self, code: str) -> int | None:
        """교환 코드 → user_id. GETDEL 이라 두 번째 호출부터는 None."""
        raw = await self._redis.getdel(_CODE_KEY.format(code))
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None


_store: SocialStore | None = None


def get_social_store() -> SocialStore:
    """FastAPI 의존성 — 프로세스 싱글턴(REDIS_URL)."""
    global _store
    if _store is None:
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _store = SocialStore(aioredis.from_url(url, decode_responses=True))
    return _store

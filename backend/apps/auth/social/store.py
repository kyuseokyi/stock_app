"""Redis 저장소 — state nonce 1회 사용 + 일회용 교환 코드(60초).

라우터는 `Depends(get_social_store)` 로 받으므로 테스트는 fakeredis 로 교체한다.
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass

import redis.asyncio as aioredis

NONCE_TTL_SECONDS = 600
EXCHANGE_CODE_TTL_SECONDS = 60

_NONCE_KEY = "auth:social:nonce:{}"
_CODE_KEY = "auth:social:code:{}"


@dataclass(frozen=True)
class ExchangeGrant:
    """교환 코드에 묶인 사용자·verifier challenge·로그인 플랫폼(서명된 state 의 client: web|app)."""

    user_id: int
    cc: str
    client: str = "web"


class SocialStore:
    def __init__(self, redis: aioredis.Redis):
        self._redis = redis

    async def use_nonce(self, nonce: str) -> bool:
        """처음 쓰는 nonce 면 True, 이미 쓴 nonce 면 False(SET NX)."""
        ok = await self._redis.set(_NONCE_KEY.format(nonce), "1", nx=True, ex=NONCE_TTL_SECONDS)
        return bool(ok)

    async def issue_exchange_code(self, user_id: int, cc: str, client: str = "web") -> str:
        code = secrets.token_urlsafe(32)
        value = json.dumps({"user_id": user_id, "cc": cc, "client": client})
        await self._redis.set(_CODE_KEY.format(code), value, ex=EXCHANGE_CODE_TTL_SECONDS)
        return code

    async def consume_exchange_code(self, code: str) -> ExchangeGrant | None:
        """교환 코드 → (user_id, cc, client; client 없는 옛 grant 는 web). GETDEL 이라 두 번째 호출부터는 None. 형식이 깨졌으면 None."""
        raw = await self._redis.getdel(_CODE_KEY.format(code))
        if raw is None:
            return None
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        user_id, cc = data.get("user_id"), data.get("cc")
        if not isinstance(user_id, int) or isinstance(user_id, bool) or not isinstance(cc, str):
            return None
        client = data.get("client")
        return ExchangeGrant(user_id=user_id, cc=cc, client=client if client in ("web", "app") else "web")


_store: SocialStore | None = None


def get_social_store() -> SocialStore:
    """FastAPI 의존성 — 프로세스 싱글턴(REDIS_URL)."""
    global _store
    if _store is None:
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _store = SocialStore(aioredis.from_url(url, decode_responses=True))
    return _store

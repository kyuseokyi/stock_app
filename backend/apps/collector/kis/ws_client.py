"""KIS 실시간 WebSocket 클라이언트(async).

approval_key 를 발급(캐싱)하고, H0STCNT0 를 구독해 수신 원문을 yield 한다.
끊기면 지수 백오프로 재연결·재구독한다. PINGPONG 프레임은 내부에서 pong 응답.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os

import httpx
import redis.asyncio as aioredis
import websockets

from shared.kis_config import KISConfig

log = logging.getLogger(__name__)

_APPROVAL_TTL = 23 * 3600  # approval_key 보수적 TTL(초)
_BACKOFF_MAX = 30.0


async def issue_approval_key(cfg: KISConfig, redis_url: str) -> str:
    """POST /oauth2/Approval 로 approval_key 발급(Redis 캐싱)."""
    rkey = f"kis:approval:{cfg.mode}:{cfg.app_key[:10]}"
    r = aioredis.from_url(redis_url, decode_responses=True)
    try:
        cached = await r.get(rkey)
        if cached:
            return cached
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{cfg.base_url}/oauth2/Approval",
                json={
                    "grant_type": "client_credentials",
                    "appkey": cfg.app_key,
                    "secretkey": cfg.app_secret,
                },
            )
            resp.raise_for_status()
            key = resp.json()["approval_key"]
        await r.set(rkey, key, ex=_APPROVAL_TTL)
        return key
    finally:
        await r.aclose()


async def invalidate_approval_key(cfg: KISConfig, redis_url: str) -> None:
    """캐시된 approval_key 삭제(무효 키 재사용 방지)."""
    rkey = f"kis:approval:{cfg.mode}:{cfg.app_key[:10]}"
    r = aioredis.from_url(redis_url, decode_responses=True)
    try:
        await r.delete(rkey)
    finally:
        await r.aclose()


def _subscribe_frame(approval_key: str, ticker: str) -> str:
    return json.dumps(
        {
            "header": {
                "approval_key": approval_key,
                "custtype": "P",
                "tr_type": "1",
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": "H0STCNT0", "tr_key": ticker}},
        }
    )


class KISWebSocketClient:
    def __init__(self, cfg: KISConfig, ticker: str, redis_url: str | None = None):
        self.cfg = cfg
        self.ticker = ticker
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")

    async def stream(self):
        """연결→구독→수신 원문 yield. 끊기면 지수 백오프 재연결."""
        backoff = 1.0
        while True:
            try:
                approval_key = await issue_approval_key(self.cfg, self.redis_url)
                async with websockets.connect(self.cfg.ws_url, ping_interval=None) as ws:
                    await ws.send(_subscribe_frame(approval_key, self.ticker))
                    log.info("KIS WS 구독: %s", self.ticker)
                    backoff = 1.0  # 성공 시 백오프 리셋
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8", "ignore")
                        if raw.startswith("{"):
                            # 제어/응답 프레임(JSON): 소비자에게 넘기지 않는다.
                            if "PINGPONG" in raw:
                                await ws.send(raw)  # pong
                                continue
                            try:
                                rt_cd = json.loads(raw).get("body", {}).get("rt_cd")
                            except (ValueError, AttributeError):
                                rt_cd = None
                            if rt_cd is not None and rt_cd != "0":
                                # 구독 실패(예: approval_key 무효) → 캐시 무효화 후 재연결(신규 키)
                                log.warning("KIS WS 구독 실패, approval_key 재발급: %s", raw[:200])
                                await invalidate_approval_key(self.cfg, self.redis_url)
                                raise RuntimeError("KIS subscribe failed; reissuing approval key")
                            # rt_cd == "0" (구독 성공 ack) 등 → skip
                            continue
                        yield raw
            except Exception as e:  # noqa: BLE001 — 재연결 목적의 광범위 포획
                log.warning("KIS WS 끊김/오류: %s (재연결 %.0fs)", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _BACKOFF_MAX)

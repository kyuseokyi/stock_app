"""KIS 실시간 WebSocket 클라이언트(async).

approval_key 를 발급(캐싱)하고, 체결 TR(기본 H0UNCNT0 통합 KRX+NXT)을 구독해 수신 원문을 yield 한다.
끊기면 지수 백오프로 재연결·재구독한다. PINGPONG 프레임은 내부에서 pong 응답.

구독 거부(rt_cd!=0) 처리:
- 1회차는 approval_key 무효로 보고 캐시 무효화 후 재연결(기존 동작).
- UN(H0UNCNT0) 구독이 새 키로도 연속 거부되면(NXT 미상장 등) KRX(H0STCNT0)로 전환한다.

장운영정보(status_tr_id, 예: H0STMKO0 — VI·거래정지·서킷브레이크·사이드카)를 같은 연결에 추가 구독할 수 있다.
응답 프레임은 header.tr_id 로 구분 — 장운영정보 구독 거부는 로그만 남기고 그 구독만 끈다
(체결 구독 거부로 오인해 키 재발급·KRX 전환이 일어나지 않게). tr_id 가 없는 응답은 체결 응답으로 본다.
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

TR_UNIFIED = "H0UNCNT0"  # 국내주식 실시간체결가(통합)
TR_KRX = "H0STCNT0"      # 국내주식 실시간체결가(KRX)
_UNIFIED_REJECT_LIMIT = 2  # UN 연속 거부 n회 → KRX 전환


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


def _subscribe_frame(approval_key: str, ticker: str, tr_id: str = TR_KRX) -> str:
    return json.dumps(
        {
            "header": {
                "approval_key": approval_key,
                "custtype": "P",
                "tr_type": "1",
                "content-type": "utf-8",
            },
            "body": {"input": {"tr_id": tr_id, "tr_key": ticker}},
        }
    )


class KISWebSocketClient:
    def __init__(
        self,
        cfg: KISConfig,
        ticker: str,
        redis_url: str | None = None,
        tr_id: str = TR_UNIFIED,
        status_tr_id: str | None = None,
    ):
        self.cfg = cfg
        self.ticker = ticker
        self.tr_id = tr_id
        self.status_tr_id = status_tr_id
        # 장운영정보 응답으로 볼 tr_id — 구독을 끈 뒤 늦게 온 거부 응답도 체결 거부로 오인하지 않게 유지
        self._status_ack_trs = {status_tr_id} if status_tr_id else set()
        self._unified_rejects = 0
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0")

    async def stream(self):
        """연결→구독→수신 원문 yield. 끊기면 지수 백오프 재연결."""
        backoff = 1.0
        while True:
            try:
                approval_key = await issue_approval_key(self.cfg, self.redis_url)
                async with websockets.connect(self.cfg.ws_url, ping_interval=None) as ws:
                    await ws.send(_subscribe_frame(approval_key, self.ticker, self.tr_id))
                    log.info("KIS WS 구독: %s tr_id=%s", self.ticker, self.tr_id)
                    if self.status_tr_id:
                        await ws.send(_subscribe_frame(approval_key, self.ticker, self.status_tr_id))
                        log.info("KIS WS 장운영정보 구독: %s tr_id=%s", self.ticker, self.status_tr_id)
                    async for raw in ws:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8", "ignore")
                        if raw.startswith("{"):
                            # 제어/응답 프레임(JSON): 소비자에게 넘기지 않는다.
                            if "PINGPONG" in raw:
                                await ws.send(raw)  # pong
                                continue
                            try:
                                frame = json.loads(raw)
                                rt_cd = frame.get("body", {}).get("rt_cd")
                                ack_tr = (frame.get("header") or {}).get("tr_id")
                            except (ValueError, AttributeError):
                                rt_cd, ack_tr = None, None
                            if ack_tr in self._status_ack_trs:
                                if rt_cd is not None and rt_cd != "0":
                                    # 장운영정보만 끈다 — 체결 구독·approval_key 에는 영향 없음
                                    log.warning("KIS WS 장운영정보 구독 거부 → 끔: %s", raw[:200])
                                    self.status_tr_id = None
                                continue
                            if rt_cd is not None and rt_cd != "0":
                                if self._on_subscribe_rejected(raw):
                                    # 방금 UN→KRX 전환: 키는 새 것이므로 무효화 없이 재구독
                                    raise RuntimeError("KIS unified subscribe rejected; switching to KRX")
                                # 구독 실패(예: approval_key 무효) → 캐시 무효화 후 재연결(신규 키)
                                log.warning("KIS WS 구독 실패, approval_key 재발급: %s", raw[:200])
                                await invalidate_approval_key(self.cfg, self.redis_url)
                                raise RuntimeError("KIS subscribe failed; reissuing approval key")
                            if rt_cd == "0":
                                backoff = 1.0  # 구독 성공 확인 → 백오프 리셋
                                if self.tr_id == TR_UNIFIED:
                                    self._unified_rejects = 0
                            continue
                        backoff = 1.0  # 첫 데이터 프레임(ack 미확인 대비)
                        if self.tr_id == TR_UNIFIED:
                            self._unified_rejects = 0
                        yield raw
            except Exception as e:  # noqa: BLE001 — 재연결 목적의 광범위 포획
                log.warning("KIS WS 끊김/오류: %s (재연결 %.0fs)", e, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, _BACKOFF_MAX)

    def _on_subscribe_rejected(self, raw: str) -> bool:
        """UN 구독 거부 횟수를 세고, 한도 도달 시 KRX(H0STCNT0)로 전환한다(전환 시 True)."""
        if self.tr_id != TR_UNIFIED:
            return False
        self._unified_rejects += 1
        if self._unified_rejects < _UNIFIED_REJECT_LIMIT:
            return False
        log.warning(
            "KIS WS 통합(UN) 구독 %d회 연속 거부 → KRX(H0STCNT0) 폴백: ticker=%s %s",
            self._unified_rejects, self.ticker, raw[:200],
        )
        self.tr_id = TR_KRX
        return True

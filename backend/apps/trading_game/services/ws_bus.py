"""WS 전달 버스(Redis Pub/Sub) — 인스턴스 N개에서 각자 자기 로컬 접속자에게만 전달.

발행(어느 인스턴스든):
  - publish_all(msg)   → `game:ws:broadcast` {"aud":"all","msg":…}   (로그인+공개: tick·sentiment)
  - publish_users(msg) → `game:ws:broadcast` {"aud":"users","msg":…} (로그인만: 데일리 코치)
  - publish_user(uid, msg) → `game:ws:user:{uid}` 원본 메시지          (개인: position_pnl·nudge)
구독(인스턴스마다 1개, run_subscriber): 받은 메시지를 자기 프로세스의 ConnectionManager 로 전달
(로컬 접속자 없으면 아무 일도 없음). 클라이언트가 받는 JSON 은 기존과 동일.

발행은 best-effort — Redis 오류는 로그만 남기고 호출부(주문·코치 발행 등)를 실패시키지 않는다.
단일 인스턴스에서도 같은 경로(Pub/Sub 왕복, 지연 수 ms).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Callable

from apps.trading_game import deps
from apps.trading_game.services.connection_manager import ConnectionManager

log = logging.getLogger("trading_game.ws_bus")

BROADCAST_CHANNEL = "game:ws:broadcast"
USER_CHANNEL_PREFIX = "game:ws:user:"
USER_CHANNEL_PATTERN = USER_CHANNEL_PREFIX + "*"

AUD_ALL = "all"
AUD_USERS = "users"


def user_channel(user_id: int) -> str:
    return f"{USER_CHANNEL_PREFIX}{user_id}"


async def _publish(channel: str, data: dict, redis=None) -> None:
    try:
        r = redis if redis is not None else deps.get_redis()
        await r.publish(channel, json.dumps(data, ensure_ascii=False))
    except Exception:
        log.warning("WS 버스 발행 실패 channel=%s", channel, exc_info=True)


async def publish_all(msg: dict, redis=None) -> None:
    """전체(로그인+공개) — tick·sentiment."""
    await _publish(BROADCAST_CHANNEL, {"aud": AUD_ALL, "msg": msg}, redis)


async def publish_users(msg: dict, redis=None) -> None:
    """로그인 연결 전체(공개 제외) — 데일리 코치 등."""
    await _publish(BROADCAST_CHANNEL, {"aud": AUD_USERS, "msg": msg}, redis)


async def publish_user(user_id: int, msg: dict, redis=None) -> None:
    """특정 유저의 로그인 연결 — position_pnl·nudge."""
    await _publish(user_channel(user_id), msg, redis)


async def dispatch(manager: ConnectionManager, message: dict) -> None:
    """Pub/Sub 메시지 1건 → 로컬 매니저 전달. 알 수 없는 형식은 무시."""
    kind = message.get("type")
    if kind == "message" and message.get("channel") == BROADCAST_CHANNEL:
        env = json.loads(message["data"])
        aud, msg = env.get("aud"), env.get("msg")
        if not isinstance(msg, dict):
            return
        if aud == AUD_ALL:
            await manager.broadcast(msg)
        elif aud == AUD_USERS:
            await manager.broadcast_users(msg)
    elif kind == "pmessage":
        channel = message.get("channel") or ""
        if not channel.startswith(USER_CHANNEL_PREFIX):
            return
        try:
            user_id = int(channel[len(USER_CHANNEL_PREFIX):])
        except ValueError:
            return
        if user_id not in manager.user_ids():  # 이 인스턴스에 접속 안 함 → 무시
            return
        await manager.send_to_user(user_id, json.loads(message["data"]))


async def run_subscriber(
    manager: ConnectionManager,
    stop: asyncio.Event,
    redis_factory: Callable | None = None,
    *,
    ready: asyncio.Event | None = None,
    max_backoff: float = 30.0,
    extra_channels: dict[str, Callable[[], None]] | None = None,
) -> None:
    """인스턴스당 1개 — broadcast 채널 + user:* 패턴 구독, 끊기면 지수 백오프 재연결.

    redis_factory: 호출 시 새 Redis 클라이언트(구독 전용 연결). 기본은 deps.REDIS_URL.
    ready: 구독이 성립되면 set(테스트·기동 동기화용).
    extra_channels: 같은 구독 연결로 받을 추가 채널 → 콜백(예: game:cache:dirty → 로컬 캐시 dirty).
    """
    extra = dict(extra_channels or {})
    if redis_factory is None:
        import redis.asyncio as aioredis

        redis_factory = lambda: aioredis.from_url(deps.REDIS_URL, decode_responses=True)  # noqa: E731
    backoff = 1.0
    while not stop.is_set():
        redis = None
        pubsub = None
        try:
            redis = redis_factory()
            pubsub = redis.pubsub()
            await pubsub.subscribe(BROADCAST_CHANNEL)
            await pubsub.psubscribe(USER_CHANNEL_PATTERN)
            if extra:
                await pubsub.subscribe(*extra.keys())
            log.info("WS 버스 구독 시작")
            if ready is not None:
                ready.set()
            while not stop.is_set():
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    continue
                backoff = 1.0
                try:
                    handler = extra.get(msg.get("channel")) if msg.get("type") == "message" else None
                    if handler is not None:
                        handler()
                        continue
                    await dispatch(manager, msg)
                except Exception:
                    log.exception("WS 버스 메시지 전달 실패 — skip")
        except asyncio.CancelledError:
            break
        except Exception:
            log.exception("WS 버스 구독 오류 — %ss 후 재연결", backoff)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            backoff = min(backoff * 2, max_backoff)
        finally:
            if pubsub is not None:
                with contextlib.suppress(Exception):
                    await pubsub.aclose()
            if redis is not None:
                with contextlib.suppress(Exception):
                    await redis.aclose()
    log.info("WS 버스 구독 종료")

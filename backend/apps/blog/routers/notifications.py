"""실시간 알림 SSE(Server-Sent Events) 라우터.

웹 클라이언트가 `/api/v1/notifications/stream` 에 EventSource 로 연결하면,
Redis 채널로 들어오는 알림 이벤트를 즉시 스트리밍한다.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..events import NOTIFICATION_CHANNEL, get_redis

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

# 하트비트 주기(초) — 프록시/브라우저 연결 유지를 위해 주기적으로 코멘트를 보낸다.
_HEARTBEAT_SEC = 15


@router.get("/stream")
async def stream(request: Request):
    async def event_generator():
        pubsub = get_redis().pubsub()
        await pubsub.subscribe(NOTIFICATION_CHANNEL)
        try:
            # 최초 연결 확인용 코멘트
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=_HEARTBEAT_SEC
                )
                if message and message.get("type") == "message":
                    yield f"event: notification\ndata: {message['data']}\n\n"
                else:
                    # 타임아웃 → 하트비트
                    yield ": ping\n\n"
        finally:
            await pubsub.unsubscribe(NOTIFICATION_CHANNEL)
            await pubsub.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 버퍼링 비활성화
        },
    )

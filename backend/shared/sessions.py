"""플랫폼별 단일 세션 — 발급(auth)·검증(모든 서비스)·즉시 끊기 알림(Redis)이 공유한다.

원본은 PostgreSQL user_sessions(user_id, platform) → sid. Redis 발행은 반응 속도용 best-effort 이며,
실패해도 다음 REST·WS 재접속에서 check_session 이 이전 토큰을 거부한다.
"""
from __future__ import annotations

import json
import logging
import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import SESSION_PLATFORMS, UserSession

log = logging.getLogger("shared.sessions")

SESSION_REPLACED = "SESSION_REPLACED"
SESSION_REPLACED_MESSAGE = "다른 기기에서 로그인되어 로그아웃됐어요."
SESSION_REPLACED_CHANNEL = "auth:session:replaced"


async def start_session(db: AsyncSession, user_id: int, platform: str) -> str:
    """새 sid 를 만들어 (user_id, platform) 행에 덮어쓰고 commit → sid. 같은 플랫폼의 이전 토큰은 이 시점부터 무효."""
    if platform not in SESSION_PLATFORMS:
        raise ValueError(f"unknown platform: {platform}")
    sid = secrets.token_urlsafe(24)
    for attempt in range(2):  # 동시 첫 로그인(INSERT 경합) 1회 재시도
        try:
            row = await db.get(UserSession, (user_id, platform))
            if row is None:
                db.add(UserSession(user_id=user_id, platform=platform, sid=sid))
            else:
                row.sid = sid
            await db.commit()
            return sid
        except IntegrityError:
            await db.rollback()
            if attempt == 1:
                raise
    raise RuntimeError("unreachable")


async def check_session(db: AsyncSession, user_id: int, payload: dict) -> bool:
    """토큰 payload 가 지금 유효한 세션인지. sid 없는 레거시 토큰은 허용(최대 12h 후 자연 만료)."""
    sid = payload.get("sid")
    if sid is None:
        return True
    platform = payload.get("plt")
    if platform not in SESSION_PLATFORMS:
        return False
    row = await db.get(UserSession, (user_id, platform))
    return row is not None and row.sid == sid


async def publish_session_replaced(redis, user_id: int, platform: str, sid: str) -> None:
    """같은 플랫폼의 이전 기기 즉시 끊기 알림(sid = 새 현재 sid). 실패는 로그만."""
    try:
        await redis.publish(
            SESSION_REPLACED_CHANNEL,
            json.dumps({"user_id": user_id, "platform": platform, "sid": sid}),
        )
    except Exception:
        log.warning("세션 교체 알림 발행 실패 user=%s platform=%s", user_id, platform, exc_info=True)

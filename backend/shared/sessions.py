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
# 세션 행 없음(로그아웃·리프레시 재사용 감지·비활성) — 다른 기기 로그인과 안내 문구를 구분한다
SESSION_ENDED = "SESSION_ENDED"
SESSION_ENDED_MESSAGE = "로그아웃됐어요. 다시 로그인해 주세요."
# 같은 채널에 kind 로 구분해 싣는다(kind 없음 = 교체, 구 게이트웨이 호환)
SESSION_EVENT_ENDED = "ended"

# check_session 결과
SESSION_OK = "ok"
SESSION_STATE_REPLACED = "replaced"
SESSION_STATE_ENDED = "ended"


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


async def check_session(db: AsyncSession, user_id: int, payload: dict) -> str:
    """토큰 payload 의 세션 상태 → SESSION_OK / SESSION_STATE_REPLACED / SESSION_STATE_ENDED.

    sid 없는 레거시 토큰은 허용(최대 12h 후 자연 만료). sid 는 있는데 플랫폼을 모르면 교체로 본다(기존 거부 유지).
    세션 행이 없으면(로그아웃·재사용 감지·비활성으로 삭제) 종료, 행의 sid 가 다르면(같은 플랫폼 재로그인) 교체.
    ⚠️ 문자열이라 항상 truthy — 반드시 상수와 비교할 것.
    """
    sid = payload.get("sid")
    if sid is None:
        return SESSION_OK
    platform = payload.get("plt")
    if platform not in SESSION_PLATFORMS:
        return SESSION_STATE_REPLACED
    row = await db.get(UserSession, (user_id, platform))
    if row is None:
        return SESSION_STATE_ENDED
    return SESSION_OK if row.sid == sid else SESSION_STATE_REPLACED


async def publish_session_replaced(redis, user_id: int, platform: str, sid: str) -> None:
    """같은 플랫폼의 이전 기기 즉시 끊기 알림(sid = 새 현재 sid). 실패는 로그만."""
    try:
        await redis.publish(
            SESSION_REPLACED_CHANNEL,
            json.dumps({"user_id": user_id, "platform": platform, "sid": sid}),
        )
    except Exception:
        log.warning("세션 교체 알림 발행 실패 user=%s platform=%s", user_id, platform, exc_info=True)


async def publish_session_ended(redis, user_id: int, platform: str, sid: str) -> None:
    """세션 종료(로그아웃·재사용 감지·비활성) → 그 sid 의 열린 소켓 즉시 닫기 알림(sid = 끝난 sid). 실패는 로그만."""
    if redis is None:
        return
    try:
        await redis.publish(
            SESSION_REPLACED_CHANNEL,
            json.dumps({"user_id": user_id, "platform": platform, "sid": sid, "kind": SESSION_EVENT_ENDED}),
        )
    except Exception:
        log.warning("세션 종료 알림 발행 실패 user=%s platform=%s", user_id, platform, exc_info=True)

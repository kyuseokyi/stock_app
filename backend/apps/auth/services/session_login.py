"""로그인 토큰 발급 공통 경로 — 세션 시작(commit) → 토큰 → 같은 플랫폼 이전 기기 끊기 알림.

라우터(/login·/guest·/social/exchange)는 이 함수만 부른다. 세션 저장 실패면 토큰을 내주지 않는다(예외 전파).
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.security import create_access_token
from shared.sessions import publish_session_replaced, start_session


async def issue_login_token(db: AsyncSession, redis, user: User, platform: str) -> str:
    user_id, role = user.id, user.role.value
    sid = await start_session(db, user_id, platform)
    token = create_access_token(subject=user_id, role=role, sid=sid, platform=platform)
    await publish_session_replaced(redis, user_id, platform, sid)
    return token

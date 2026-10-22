"""로그인 토큰 발급 공통 경로 — 세션 시작(commit) → 토큰 → 같은 플랫폼 이전 기기 끊기 알림.

라우터(/login·/guest·/social/exchange)는 이 함수만 부른다. 세션 저장 실패면 토큰을 내주지 않는다(예외 전파).
앱(platform=app) 로그인이면 리프레시 토큰도 발급한다(웹·관리자는 기존 그대로 — refresh_token·expires_in 은 None).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.security import create_access_token
from shared.sessions import publish_session_replaced, start_session

from . import refresh_tokens


@dataclass(frozen=True)
class LoginTokens:
    access_token: str
    refresh_token: str | None = None
    expires_in: int | None = None  # 접근 토큰 수명(초) — 앱만


async def issue_login_token(db: AsyncSession, redis, user: User, platform: str) -> LoginTokens:
    user_id, role = user.id, user.role.value
    sid = await start_session(db, user_id, platform)
    token = create_access_token(subject=user_id, role=role, sid=sid, platform=platform)
    refresh = None
    expires_in = None
    if platform == refresh_tokens.APP_PLATFORM:
        refresh = await refresh_tokens.issue(db, user_id, sid)
        expires_in = refresh_tokens.app_access_expires_in()
    await publish_session_replaced(redis, user_id, platform, sid)
    return LoginTokens(access_token=token, refresh_token=refresh, expires_in=expires_in)

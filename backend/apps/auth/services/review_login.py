"""심사 전용 로그인 서비스 — 허용 목록 이메일 + 비밀번호 확인 후 일반 회원과 같은 세션 규칙으로 토큰 발급.

판정 순서(정보 노출 방지): 허용 목록 → 사용자·비밀번호 → 관리자 거부 → 비활성.
허용 목록 밖·없는 사용자·해시 없음·비밀번호 불일치·관리자는 모두 같은 401 문구.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User, UserRole
from shared.security import verify_password

from ..review_gate import review_login_emails
from .session_login import LoginTokens, issue_login_token

BAD_CREDENTIALS = "이메일 또는 비밀번호가 올바르지 않습니다."


class ReviewLoginError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


async def review_login(
    db: AsyncSession, redis, email: str, password: str, platform: str
) -> tuple[LoginTokens, User]:
    email = email.strip()
    if email.lower() not in review_login_emails():
        raise ReviewLoginError(401, BAD_CREDENTIALS)

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(password, user.password_hash):
        raise ReviewLoginError(401, BAD_CREDENTIALS)
    if user.role == UserRole.ADMIN:  # 관리자는 기존 /login(admin 플랫폼)만
        raise ReviewLoginError(401, BAD_CREDENTIALS)
    if not user.is_active:
        raise ReviewLoginError(403, "비활성화된 계정입니다.")

    tokens = await issue_login_token(db, redis, user, platform)
    return tokens, user

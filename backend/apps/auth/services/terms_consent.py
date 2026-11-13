"""이용약관 동의 저장 서비스 — 라우터(POST /me/terms)는 이 함수만 부르고 도메인 예외를 HTTP 로 바꾼다."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User

from ..terms import TERMS_VERSION


class TermsError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def agree_terms(db: AsyncSession, user: User, version: str) -> User:
    """현재 버전이면 동의 버전·시각을 저장(이미 동의했어도 다시 저장 — 멱등 200). 다르면 TermsError."""
    if version != TERMS_VERSION:
        raise TermsError(
            "TERMS_VERSION_MISMATCH",
            "약관이 갱신되었습니다. 앱을 업데이트한 뒤 다시 시도해 주세요.",
        )
    user.terms_version = TERMS_VERSION
    user.terms_agreed_at = _utcnow()
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

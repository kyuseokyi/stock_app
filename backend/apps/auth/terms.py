"""이용약관 버전·동의 판정.

약관을 바꾸면 TERMS_VERSION 과 웹 `TermsPage` 시행일을 같이 바꾼다 → 기존 회원도 다시 동의해야 한다.
가벼운 모듈(shared.models 만 의존) — blog 댓글 작성 게이트도 이 판정을 쓴다.
"""
from __future__ import annotations

from shared.models import UserRole

TERMS_VERSION = "2026-11-13"


def terms_required(user) -> bool:
    """약관 (재)동의가 필요한가. 관리자는 항상 False, 그 밖에는 동의 버전이 현재 버전과 다르면 True."""
    if user.role == UserRole.ADMIN:
        return False
    return user.terms_version != TERMS_VERSION

"""심사 전용 로그인 게이트 — `REVIEW_LOGIN_EMAILS`(쉼표 구분).

- 비어 있거나 실제 이메일 항목이 없으면 기능 꺼짐 → 엔드포인트가 없는 것처럼 404(guest_gate 와 같은 방식).
- 비교는 앞뒤 공백 제거 + 소문자.
env 는 요청 시점에 읽는다(심사 기간에만 넣고 빼는 운영 + 테스트 monkeypatch).
"""
from __future__ import annotations

import os

from fastapi import HTTPException, status


def review_login_emails() -> frozenset[str]:
    raw = os.getenv("REVIEW_LOGIN_EMAILS") or ""
    return frozenset(e.strip().lower() for e in raw.split(",") if e.strip())


def require_review_login_enabled() -> None:
    """라우트 의존성 — 허용 목록이 비면 404."""
    if not review_login_emails():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")

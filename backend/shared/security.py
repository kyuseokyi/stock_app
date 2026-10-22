"""인증 보안 유틸 — 비밀번호 해시(bcrypt)와 JWT 발급/검증.

환경변수:
    JWT_SECRET_KEY   : 토큰 서명 키 (운영에서는 반드시 설정)
    JWT_ALGORITHM    : 기본 HS256
    JWT_EXPIRE_HOURS : Access 토큰 만료(시간), 기본 12 — 웹·관리자
    JWT_APP_EXPIRE_MINUTES : 앱(platform=app) Access 토큰 만료(분), 기본 60 — 리프레시 토큰으로 자동 갱신
    REFRESH_EXPIRE_DAYS : 앱 리프레시 토큰 수명(일), 기본 30 — 갱신할 때마다 새로 30일
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))
APP_EXPIRE_MINUTES = int(os.getenv("JWT_APP_EXPIRE_MINUTES", "60"))
REFRESH_EXPIRE_DAYS = int(os.getenv("REFRESH_EXPIRE_DAYS", "30"))


# --- 비밀번호 --------------------------------------------------------------- #
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- JWT -------------------------------------------------------------------- #
def access_token_ttl(platform: str | None) -> timedelta:
    """접근 토큰 수명 — 앱은 짧게(리프레시로 갱신), 웹·관리자·레거시는 기존 JWT_EXPIRE_HOURS."""
    if platform == "app":
        return timedelta(minutes=APP_EXPIRE_MINUTES)
    return timedelta(hours=EXPIRE_HOURS)


def create_access_token(
    *,
    subject: str | int,
    role: str,
    sid: str | None = None,
    platform: str | None = None,
    now: datetime | None = None,
) -> str:
    """sid·platform 은 플랫폼별 단일 세션용(shared/sessions.py). 없으면 기존과 같은 토큰(레거시 호환).

    now 는 테스트용(만료 토큰 만들기). 기본은 현재 UTC.
    """
    now = now or datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "role": role,
        "iat": now,
        "exp": now + access_token_ttl(platform),
    }
    if sid is not None:
        payload["sid"] = sid
    if platform is not None:
        payload["plt"] = platform
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """유효하면 payload dict, 실패 시 jwt 예외를 던진다."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# --- 리프레시 토큰(앱) ------------------------------------------------------- #
def new_refresh_token() -> str:
    """불투명 난수 리프레시 토큰(클라이언트에만 원문, 서버엔 해시만)."""
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    """서버 저장·조회용 SHA-256 hex(64자)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

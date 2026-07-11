"""인증 보안 유틸 — 비밀번호 해시(bcrypt)와 JWT 발급/검증.

환경변수:
    JWT_SECRET_KEY   : 토큰 서명 키 (운영에서는 반드시 설정)
    JWT_ALGORITHM    : 기본 HS256
    JWT_EXPIRE_HOURS : Access 토큰 만료(시간), 기본 12
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-change-me")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "12"))


# --- 비밀번호 --------------------------------------------------------------- #
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- JWT -------------------------------------------------------------------- #
def create_access_token(*, subject: str | int, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """유효하면 payload dict, 실패 시 jwt 예외를 던진다."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

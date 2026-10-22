"""공유 인증 의존성 — JWT 검증 기반 현재 사용자/관리자 가드.

인증 서버(apps/auth)가 발급한 JWT를 각 서비스(blog, stock_api 등)가 공통으로
검증하기 위해 shared 에 둔다. 토큰 서명 키(JWT_SECRET_KEY)를 서비스 간 공유하면
어느 서비스에서든 동일하게 검증된다.
"""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from shared.models import User, UserRole
from shared.security import decode_token
from shared.sessions import SESSION_REPLACED, SESSION_REPLACED_MESSAGE, check_session

bearer_scheme = HTTPBearer(auto_error=False)

# 401 사유 코드 — 앱은 TOKEN_EXPIRED 면 리프레시로 갱신을 시도하고, 그 밖엔 로그아웃한다(웹은 코드와 무관하게 로그아웃).
TOKEN_EXPIRED = "TOKEN_EXPIRED"
TOKEN_EXPIRED_MESSAGE = "로그인이 만료됐어요. 다시 로그인해 주세요."
TOKEN_INVALID = "TOKEN_INVALID"
TOKEN_INVALID_MESSAGE = "로그인 정보가 올바르지 않아요. 다시 로그인해 주세요."


def _unauthorized(code: str, message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        {"code": code, "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "인증이 필요합니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(creds.credentials)
        user_id = int(payload.get("sub", 0))
    except jwt.ExpiredSignatureError:  # PyJWTError 의 하위 클래스 — 먼저 잡아야 만료로 분류된다
        raise _unauthorized(TOKEN_EXPIRED, TOKEN_EXPIRED_MESSAGE)
    except (jwt.PyJWTError, ValueError, TypeError):
        raise _unauthorized(TOKEN_INVALID, TOKEN_INVALID_MESSAGE)

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized(TOKEN_INVALID, TOKEN_INVALID_MESSAGE)
    # 같은 플랫폼에서 다시 로그인했으면 이전 토큰 거부 — 클라이언트는 detail.code 로 안내 문구를 구분한다
    if not await check_session(db, user.id, payload):
        raise _unauthorized(SESSION_REPLACED, SESSION_REPLACED_MESSAGE)
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "관리자 권한이 필요합니다.")
    return user

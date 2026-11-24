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

from shared import admin_permissions
from shared.database import get_db
from shared.models import User, UserRole
from shared.security import decode_token
from shared.sessions import (
    SESSION_ENDED,
    SESSION_ENDED_MESSAGE,
    SESSION_OK,
    SESSION_REPLACED,
    SESSION_REPLACED_MESSAGE,
    SESSION_STATE_ENDED,
    check_session,
)

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
    # 같은 플랫폼 재로그인(교체)·로그아웃 등으로 세션 행 삭제(종료)면 거부 — 클라이언트는 detail.code 로 안내 문구를 구분한다
    state = await check_session(db, user.id, payload)
    if state == SESSION_STATE_ENDED:
        raise _unauthorized(SESSION_ENDED, SESSION_ENDED_MESSAGE)
    if state != SESSION_OK:
        raise _unauthorized(SESSION_REPLACED, SESSION_REPLACED_MESSAGE)
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "관리자 권한이 필요합니다.")
    return user


async def require_super_admin(user: User = Depends(require_admin)) -> User:
    """관리자 계정 관리(생성·비활성화·비밀번호 초기화) 전용 — 슈퍼 관리자만."""
    if not user.is_super_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "SUPER_ADMIN_REQUIRED", "message": "슈퍼 관리자만 할 수 있어요."},
        )
    return user


async def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """선택 인증 — Authorization 헤더가 없으면 None(익명).

    헤더가 있으면 get_current_user 와 똑같이 검증하고 401 도 그대로 올린다. 잘못된·만료 토큰을 익명으로 흘리면
    로그인 사용자에게 차단·신고한 댓글이 다시 보이고, 앱의 TOKEN_EXPIRED 리프레시도 발동하지 않는다.
    """
    if creds is None:
        return None
    return await get_current_user(creds, db)


INSUFFICIENT_ADMIN_PERMISSION = "INSUFFICIENT_ADMIN_PERMISSION"


def _permission_denied(perms: tuple[str, ...]) -> HTTPException:
    return HTTPException(
        status.HTTP_403_FORBIDDEN,
        {
            "code": INSUFFICIENT_ADMIN_PERMISSION,
            "required": list(perms),
            "message": "이 기능을 쓸 관리자 권한이 없어요.",
        },
    )


async def ensure_permission(db: AsyncSession, user: User, *perms: str) -> None:
    """라우터 안에서 추가로 확인할 때(예: 특정 키만 더 엄격) — perms 중 하나라도 있으면 통과, 없으면 403."""
    have = await admin_permissions.permissions_for(db, user)
    if not have.intersection(perms):
        raise _permission_denied(perms)


def require_permission(*perms: str):
    """관리자 권한 가드 — perms 중 하나라도 있으면 통과(슈퍼 관리자는 항상). 관리자가 아니면 기존처럼 403."""
    if not perms or not set(perms) <= admin_permissions.ALL_PERMISSIONS:
        raise ValueError(f"unknown admin permission: {perms}")

    async def _guard(user: User = Depends(require_admin), db: AsyncSession = Depends(get_db)) -> User:
        await ensure_permission(db, user, *perms)
        return user

    return _guard

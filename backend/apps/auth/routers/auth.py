"""인증 라우터 — 관리자 이메일/비밀번호 로그인 및 현재 사용자 조회."""

from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User, UserRole
from shared.security import create_access_token, verify_password

from .. import schemas
from ..deps import get_redis
from ..guest_gate import require_guest_enabled
from ..services import account_deletion
from ..social.config import SocialSettings, get_social_settings
from ..social.providers import get_http_transport

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _guest_email(nickname: str) -> str:
    """닉네임을 임시 계정 식별용 이메일로 변환(같은 닉네임=같은 계정)."""
    slug = re.sub(r"[^a-z0-9]+", "-", nickname.strip().lower()).strip("-")
    if not slug:  # 한글/특수문자만인 경우 코드포인트로 대체
        slug = "u" + "".join(str(ord(c)) for c in nickname.strip())[:40]
    return f"{slug}@guest.local"


@router.post("/login", response_model=schemas.TokenResponse)
async def login(payload: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if (
        user is None
        or not user.password_hash
        or not verify_password(payload.password, user.password_hash)
    ):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않습니다."
        )
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "비활성화된 계정입니다.")

    token = create_access_token(subject=user.id, role=user.role.value)
    return schemas.TokenResponse(access_token=token, user=user)


@router.post(
    "/guest",
    response_model=schemas.TokenResponse,
    dependencies=[Depends(require_guest_enabled)],  # AUTH_GUEST_ENABLED 게이트(꺼짐 → 404)
)
async def guest_login(
    payload: schemas.GuestLoginRequest, db: AsyncSession = Depends(get_db)
):
    """임시 로그인 — 닉네임으로 FREE 유저 upsert 후 JWT 발급.

    카카오/구글 OAuth 도입 시 콜백에서도 동일한 'upsert → 토큰 발급' 경로를 따른다.
    """
    nickname = payload.nickname.strip()
    email = _guest_email(nickname)

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(email=email, nickname=nickname, role=UserRole.FREE, is_active=True)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif user.nickname != nickname:
        user.nickname = nickname
        await db.commit()
        await db.refresh(user)

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "비활성화된 계정입니다.")

    token = create_access_token(subject=user.id, role=user.role.value)
    return schemas.TokenResponse(access_token=token, user=user)


@router.get("/me", response_model=schemas.UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    payload: schemas.DeleteAccountRequest | None = Body(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
    settings: SocialSettings = Depends(get_social_settings),
    transport=Depends(get_http_transport),
) -> Response:
    """회원 탈퇴 — 본문 {"confirm": "탈퇴"}. 공개 기록은 '탈퇴한 회원'으로 익명화, 나머지는 삭제."""
    try:
        await account_deletion.delete_account(
            db, user,
            confirm=payload.confirm if payload else None,
            redis=redis,
            kakao_admin_key=settings.kakao_admin_key,
            transport=transport,
        )
    except account_deletion.AccountDeletionError as e:
        code = status.HTTP_403_FORBIDDEN if e.code == "ADMIN_CANNOT_DELETE" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, detail={"code": e.code, "message": str(e)})
    return Response(status_code=status.HTTP_204_NO_CONTENT)

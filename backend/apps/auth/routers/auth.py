"""인증 라우터 — 관리자 이메일/비밀번호 로그인 및 현재 사용자 조회."""

from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User, UserRole
from shared.security import verify_password

from .. import schemas
from ..deps import get_redis
from ..guest_gate import require_guest_enabled
from ..services import account_deletion, refresh_tokens
from ..services.session_login import issue_login_token
from ..social.config import SocialSettings, get_social_settings
from ..social.providers import get_http_transport

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# 토큰이 담긴 응답·토큰을 받는 요청의 응답은 중간 캐시(프록시·브라우저)에 남기지 않는다
NO_STORE = {"Cache-Control": "no-store"}


def no_store(response: Response) -> None:
    response.headers.update(NO_STORE)


def _guest_email(nickname: str) -> str:
    """닉네임을 임시 계정 식별용 이메일로 변환(같은 닉네임=같은 계정)."""
    slug = re.sub(r"[^a-z0-9]+", "-", nickname.strip().lower()).strip("-")
    if not slug:  # 한글/특수문자만인 경우 코드포인트로 대체
        slug = "u" + "".join(str(ord(c)) for c in nickname.strip())[:40]
    return f"{slug}@guest.local"


@router.post("/login", response_model=schemas.TokenResponse)
async def login(
    payload: schemas.LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    no_store(response)
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

    tokens = await issue_login_token(db, redis, user, "admin")  # /login 은 admin_web 전용
    return schemas.token_response(tokens, user)


@router.post(
    "/guest",
    response_model=schemas.TokenResponse,
    dependencies=[Depends(require_guest_enabled)],  # AUTH_GUEST_ENABLED 게이트(꺼짐 → 404)
)
async def guest_login(
    payload: schemas.GuestLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """임시 로그인 — 닉네임으로 FREE 유저 upsert 후 JWT 발급.

    카카오/구글 OAuth 도입 시 콜백에서도 동일한 'upsert → 토큰 발급' 경로를 따른다.
    """
    no_store(response)
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

    tokens = await issue_login_token(db, redis, user, payload.platform)
    return schemas.token_response(tokens, user)


@router.post("/refresh", response_model=schemas.TokenResponse)
async def refresh(
    payload: schemas.RefreshRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """앱 리프레시 토큰 → 새 접근 토큰 + 새 리프레시(회전, sid 유지). 접근 토큰은 필요 없다.

    401 detail = {"code": REFRESH_INVALID|REFRESH_EXPIRED|REFRESH_REUSED|SESSION_REPLACED|SESSION_ENDED, "message"}.
    세션을 끝낸 경우(재사용 감지·비활성) 열린 게임 WS 를 닫게 Redis 로 알린다(best-effort).
    """
    no_store(response)
    try:
        result = await refresh_tokens.rotate(db, payload.refresh_token, redis=redis)
    except refresh_tokens.RefreshError as e:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail={"code": e.code, "message": e.message}, headers=NO_STORE
        ) from e
    return schemas.token_response(result, result.user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: schemas.RefreshRequest | None = Body(None),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
) -> Response:
    """서버 로그아웃(앱) — 그 리프레시의 sid 를 폐기하고 앱 세션을 끊는다(열린 게임 WS 도 닫게 알림). 존재 여부를 숨기려고 항상 204."""
    await refresh_tokens.logout(db, payload.refresh_token if payload else "", redis=redis)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers=NO_STORE)


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

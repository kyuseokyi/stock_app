"""간편 로그인 라우터 — providers / start / callback / exchange.

흐름: start(?cc=challenge, 302 공급자) → callback(302 복귀 주소?code=교환코드)
     → exchange(code + code_verifier → TokenResponse).
cc/verifier 는 PKCE 방식으로 교환 코드를 시작한 클라이언트에 묶는다(social/pkce.py).
복귀 주소는 state 의 client/app_variant 로 서버 설정에서만 고른다(오픈 리다이렉트 방지).
"""

from __future__ import annotations

import logging
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_db
from shared.security import create_access_token

from .. import schemas
from ..social.config import SocialSettings, get_social_settings
from ..social.pkce import CHALLENGE_PATTERN
from ..social.providers import build_provider, get_http_transport
from ..social.service import (
    ExchangeError,
    SocialLoginError,
    complete_social_login,
    redeem_exchange_code,
)
from ..social.state import StateError, sign_state, verify_state
from ..social.store import SocialStore, get_social_store

router = APIRouter(prefix="/api/v1/auth/social", tags=["auth-social"])
logger = logging.getLogger("auth.social")

ProviderName = Literal["kakao", "naver"]
_LABELS = {"kakao": "카카오", "naver": "네이버"}
# 공급자가 '사용자 취소'로 돌려주는 error 값. 그 밖의 error 는 provider_failed.
_CANCEL_ERRORS = {"access_denied"}

_STATE_ERROR_HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>로그인 오류</title></head>
<body style="font-family:sans-serif;padding:32px;text-align:center;color:#191f28">
<h1 style="font-size:18px">로그인 요청이 만료되었거나 올바르지 않아요</h1>
<p style="color:#8b95a1">이 창을 닫고 앱 또는 웹에서 다시 로그인해 주세요.</p>
</body></html>"""


def _with_query(url: str, **params: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + list(params.items())
    return urlunsplit(parts._replace(query=urlencode(query)))


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


def _state_error_page() -> HTMLResponse:
    return HTMLResponse(_STATE_ERROR_HTML, status_code=status.HTTP_400_BAD_REQUEST)


@router.get("/providers", response_model=schemas.SocialProvidersOut)
async def providers(settings: SocialSettings = Depends(get_social_settings)):
    """버튼 노출용(공개) — 키가 설정됐거나 가짜 모드면 true."""
    return schemas.SocialProvidersOut(
        kakao=settings.is_enabled("kakao"), naver=settings.is_enabled("naver")
    )


@router.get("/{provider}/start")
async def start(
    provider: ProviderName,
    client: Literal["web", "app"] = Query(..., description="web | app"),
    app: Literal["dev", "prod"] = Query("prod", description="client=app 일 때 앱 변형(스킴 선택)"),
    cc: str = Query(
        ..., pattern=CHALLENGE_PATTERN, description="base64url(sha256(code_verifier)) — 43자, 패딩 없음"
    ),
    settings: SocialSettings = Depends(get_social_settings),
    transport: httpx.AsyncBaseTransport | None = Depends(get_http_transport),
):
    impl = build_provider(provider, settings, transport)
    if impl is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "PROVIDER_DISABLED", "message": f"{_LABELS[provider]} 로그인은 준비 중이에요."},
        )
    state = sign_state(
        settings.effective_state_secret,
        provider=provider,
        client=client,
        app_variant=app if client == "app" else None,
        cc=cc,
    )
    return _redirect(impl.authorize_url(redirect_uri=settings.redirect_uri(provider), state=state))


@router.get("/{provider}/callback")
async def callback(
    provider: ProviderName,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
    settings: SocialSettings = Depends(get_social_settings),
    store: SocialStore = Depends(get_social_store),
    transport: httpx.AsyncBaseTransport | None = Depends(get_http_transport),
):
    # 1) state 서명·만료·provider — 실패하면 복귀 주소를 모르므로 400 HTML 로 끝낸다
    if not state:
        return _state_error_page()
    try:
        payload = verify_state(settings.effective_state_secret, state, provider=provider)
    except StateError:
        return _state_error_page()
    return_url = settings.return_url(payload.client, payload.app_variant)

    # 복귀 주소를 아는 시점부터 Redis·DB 장애는 raw 500 대신 ?error=provider_failed 로 돌려보낸다
    try:
        # 2) nonce 1회 사용
        if not await store.use_nonce(payload.nonce):
            return _redirect(_with_query(return_url, error="state_invalid"))

        # 3) 공급자 오류(사용자 취소 등)
        if error:
            reason = "cancelled" if error in _CANCEL_ERRORS else "provider_failed"
            return _redirect(_with_query(return_url, error=reason))

        impl = build_provider(provider, settings, transport)
        if impl is None or not code:
            return _redirect(_with_query(return_url, error="provider_failed"))

        # 4) code → 프로필 → 사용자 → 교환 코드(cc 묶음)
        exchange_code = await complete_social_login(
            db=db,
            store=store,
            provider=impl,
            code=code,
            state=state,
            redirect_uri=settings.redirect_uri(provider),
            cc=payload.cc,
        )
    except SocialLoginError as exc:
        return _redirect(_with_query(return_url, error=exc.code))
    except (RedisError, SQLAlchemyError) as exc:
        # 예외 메시지에는 SQL 파라미터·접속 정보가 섞일 수 있어 타입명만 남긴다
        logger.error("social login callback storage failure (%s): %s", provider, type(exc).__name__)
        return _redirect(_with_query(return_url, error="provider_failed"))
    return _redirect(_with_query(return_url, code=exchange_code))


@router.post("/exchange", response_model=schemas.TokenResponse)
async def exchange(
    payload: schemas.SocialExchangeRequest,
    db: AsyncSession = Depends(get_db),
    store: SocialStore = Depends(get_social_store),
):
    """일회용 교환 코드 + code_verifier → 서비스 JWT(기존 TokenResponse 형식)."""
    try:
        user = await redeem_exchange_code(db, store, payload.code, payload.code_verifier)
    except ExchangeError as exc:
        raise HTTPException(exc.status_code, exc.message) from exc
    token = create_access_token(subject=user.id, role=user.role.value)
    return schemas.TokenResponse(access_token=token, user=user)

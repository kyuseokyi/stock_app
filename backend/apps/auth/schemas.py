"""인증 API 입출력 스키마."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from shared.models import UserRole


class LoginRequest(BaseModel):
    email: str = Field(..., description="관리자 이메일")
    password: str = Field(..., description="비밀번호")


class GuestLoginRequest(BaseModel):
    """임시 로그인 — 닉네임만 입력(개발용). platform 은 단일 세션 구분(web_client=web, 앱=app)."""

    nickname: str = Field(..., min_length=1, max_length=20, description="표시 닉네임")
    platform: Literal["web", "app"] = Field("web", description="로그인 플랫폼(미지정 시 web — 구 앱 빌드 호환)")


class DeleteAccountRequest(BaseModel):
    """회원 탈퇴 확인 — confirm 이 정확히 '탈퇴'여야 한다(아니면 400 CONFIRM_REQUIRED, 422 아님)."""

    confirm: str | None = Field(None, description="확인 문구 '탈퇴'")


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str | None
    nickname: str | None
    role: UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    # 앱(platform=app) 로그인·갱신만 채움. 웹·관리자는 null(기존 클라이언트는 무시)
    refresh_token: str | None = None
    expires_in: int | None = Field(None, description="접근 토큰 수명(초)")


def token_response(tokens, user) -> TokenResponse:
    """로그인·갱신 공통 응답. tokens 는 access_token·refresh_token·expires_in 을 가진 객체(LoginTokens·RefreshResult)."""
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
        user=user,
    )


class RefreshRequest(BaseModel):
    """앱 리프레시 토큰. 누락·빈 값도 422 가 아니라 갱신은 401, 로그아웃은 204 로 처리하려고 기본값을 둔다."""

    refresh_token: str = Field("", max_length=200)


class SocialProvidersOut(BaseModel):
    """간편 로그인 공급자 활성 여부(버튼 노출용)."""

    kakao: bool
    naver: bool


class SocialExchangeRequest(BaseModel):
    """콜백이 복귀 주소에 실어 준 일회용 교환 코드 + 시작 때 만든 verifier(PKCE).

    code_verifier 누락·불일치는 422 가 아니라 401(같은 문구)로 처리하려고 기본값을 둔다.
    """

    code: str = Field(..., min_length=1, max_length=200)
    code_verifier: str = Field("", max_length=128)

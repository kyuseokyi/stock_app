"""인증 API 입출력 스키마."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from shared.models import UserRole

from .terms import terms_required as _terms_required


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
    # 약관 (재)동의 필요 여부 — 기본값 없이 항상 계산(누락 시 조용히 false 가 되어 게이트가 무력화되지 않게)
    terms_required: bool

    @model_validator(mode="before")
    @classmethod
    def _fill_terms_required(cls, data):
        """ORM User 등 속성 객체가 오면 terms_required 를 계산해 채운다(dict 입력은 그대로)."""
        if isinstance(data, dict) or not hasattr(data, "terms_version"):
            return data
        return {
            "id": data.id,
            "email": data.email,
            "nickname": data.nickname,
            "role": data.role,
            "terms_required": _terms_required(data),
        }


class TermsAgreeRequest(BaseModel):
    """약관 동의 — 클라이언트가 보여 준 약관 버전. 서버 현재 버전과 다르면 409 TERMS_VERSION_MISMATCH."""

    version: str = Field(..., max_length=20, description="동의한 약관 버전(예 2026-11-13)")


class ReviewLoginRequest(BaseModel):
    """심사 전용 로그인 — REVIEW_LOGIN_EMAILS 에 있는 이메일만. admin 플랫폼은 받지 않는다."""

    email: str = Field(..., max_length=255)
    password: str = Field(..., max_length=200)
    platform: Literal["app", "web"] = Field("app", description="로그인 플랫폼")


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

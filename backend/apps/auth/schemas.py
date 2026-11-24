"""인증 API 입출력 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from shared import admin_permissions
from shared.models import AuthProvider, UserRole

from .terms import terms_required as _terms_required


class LoginRequest(BaseModel):
    email: str = Field(..., description="관리자 아이디(기존 시드 관리자는 이메일 형식)")
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
    # 로그인 방식(KAKAO·NAVER·GOOGLE·APPLE). 관리자 LOCAL·게스트·심사 계정은 null — 추가 필드(옛 클라이언트는 무시)
    provider: AuthProvider | None = None
    # 슈퍼 관리자 여부 — admin_web 이 '관리자 계정' 메뉴를 보일지 판단. 추가 필드(옛 클라이언트는 무시)
    is_super_admin: bool = False
    # 관리자 등급(SUPER_ADMIN·OPERATOR·ANALYST·EDITOR, 일반 회원 null)과 최종 관리자 권한 키 — admin_web 메뉴 표시용.
    # permissions 는 DB(등급 표)를 봐야 해서 /login·/me 라우터가 채운다(그 밖의 응답은 빈 배열)
    admin_tier: str | None = None
    permissions: list[str] = Field(default_factory=list)

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
            "provider": getattr(data, "provider", None),
            "is_super_admin": bool(getattr(data, "is_super_admin", False)),
            "admin_tier": admin_permissions.tier_of(data),
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


def token_response(tokens, user, permissions=None) -> TokenResponse:
    """로그인·갱신 공통 응답. tokens 는 access_token·refresh_token·expires_in 을 가진 객체(LoginTokens·RefreshResult).
    permissions 를 주면(관리자 로그인) user.permissions 에 넣는다."""
    out = UserOut.model_validate(user)
    if permissions:
        out = out.model_copy(update={"permissions": admin_permissions.ordered(permissions)})
    return TokenResponse(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
        user=out,
    )


async def user_out(db, user) -> UserOut:
    """/me 용 — 관리자면 최종 권한까지 채운다(일반 회원은 DB 를 더 보지 않는다)."""
    out = UserOut.model_validate(user)
    perms = await admin_permissions.permissions_for(db, user)
    return out.model_copy(update={"permissions": admin_permissions.ordered(perms)}) if perms else out


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


# --- 관리자 계정(슈퍼 관리자 전용 생성·관리) · 비밀번호 변경 ------------------------------------- #
# 아이디: 영문 소문자·숫자·. _ - 4~30자. '@' 를 막아 소셜 이메일·게스트(@guest.local)와 겹칠 일이 없다.
ADMIN_LOGIN_ID_PATTERN = r"^[a-z0-9._-]{4,30}$"
# bcrypt 는 72바이트까지만 본다 — 그 이상은 조용히 잘리므로 막는다
PASSWORD_MIN, PASSWORD_MAX = 8, 72


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1, description="현재 비밀번호")
    new_password: str = Field(..., min_length=PASSWORD_MIN, max_length=PASSWORD_MAX, description="새 비밀번호(8~72자)")


AdminTierKey = Literal["OPERATOR", "ANALYST", "EDITOR"]


class AdminCreateRequest(BaseModel):
    login_id: str = Field(..., pattern=ADMIN_LOGIN_ID_PATTERN, description="로그인 아이디(영문 소문자·숫자·._- 4~30자)")
    nickname: str = Field(..., min_length=1, max_length=20, description="표시 이름")
    password: str = Field(..., min_length=PASSWORD_MIN, max_length=PASSWORD_MAX, description="처음 비밀번호(8~72자)")
    admin_tier: AdminTierKey = Field("OPERATOR", description="관리자 등급(슈퍼 관리자는 만들 수 없다)")
    custom_permissions: list[str] = Field(default_factory=list, description="등급 권한에 더할 개별 권한 키")


class AdminTierUpdateRequest(BaseModel):
    admin_tier: AdminTierKey
    custom_permissions: list[str] = Field(default_factory=list)


class TierPolicyUpdateRequest(BaseModel):
    permissions: list[str] = Field(default_factory=list, description="이 등급에 줄 권한 키(ADMIN_ROLE_MANAGE 불가)")


class PermissionMeta(BaseModel):
    key: str
    label: str
    description: str
    grantable: bool  # 등급·개별 권한으로 줄 수 있는가(ADMIN_ROLE_MANAGE 는 false — 슈퍼 관리자 고정)


class TierPolicyOut(BaseModel):
    tier: str
    label: str
    permissions: list[str]


class RolePoliciesOut(BaseModel):
    permissions: list[PermissionMeta]
    tiers: list[TierPolicyOut]


class AdminPasswordResetRequest(BaseModel):
    new_password: str = Field(..., min_length=PASSWORD_MIN, max_length=PASSWORD_MAX, description="새 비밀번호(8~72자)")


class AdminActiveRequest(BaseModel):
    is_active: bool


class AdminAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    login_id: str | None = Field(None, validation_alias="email", description="로그인 아이디(users.email 에 저장)")
    nickname: str | None
    is_active: bool
    is_super_admin: bool
    admin_tier: str | None = None  # 슈퍼 관리자는 SUPER_ADMIN, 비어 있던 기존 관리자는 OPERATOR 로 보여 준다
    custom_permissions: list[str] = Field(default_factory=list)
    created_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_user(cls, data):
        if isinstance(data, dict) or not hasattr(data, "custom_permissions"):
            return data
        return {
            "id": data.id,
            "email": data.email,
            "nickname": data.nickname,
            "is_active": data.is_active,
            "is_super_admin": bool(data.is_super_admin),
            "admin_tier": admin_permissions.tier_of(data),
            "custom_permissions": admin_permissions.ordered(admin_permissions.parse_keys(data.custom_permissions)),
            "created_at": data.created_at,
        }

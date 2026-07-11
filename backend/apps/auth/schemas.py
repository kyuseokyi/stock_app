"""인증 API 입출력 스키마."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from shared.models import UserRole


class LoginRequest(BaseModel):
    email: str = Field(..., description="관리자 이메일")
    password: str = Field(..., description="비밀번호")


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

"""댓글 신고·차단·작성 금지·회원 관리(관리자) 입출력 스키마.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §2·§3
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from shared.models import AuthProvider, UserRole

ReportReason = Literal["abuse", "spam", "sexual", "privacy", "scam", "other"]
ReportStatusFilter = Literal["pending", "dismissed", "actioned", "all"]
ResolveAction = Literal["delete", "dismiss", "ban_author"]

DETAIL_MAX = 200
NICKNAME_MIN, NICKNAME_MAX = 1, 20


# --------------------------------------------------------------------------- #
# 신고
# --------------------------------------------------------------------------- #
class ReportCreate(BaseModel):
    reason: ReportReason
    detail: str | None = Field(None, max_length=DETAIL_MAX, description="기타(other)일 때 필수, 최대 200자")

    @model_validator(mode="after")
    def _detail_for_other(self):
        detail = (self.detail or "").strip()
        if self.reason == "other" and not detail:
            raise ValueError("기타 사유는 내용을 입력해야 합니다.")
        self.detail = detail or None
        return self


class ReportResult(BaseModel):
    ok: bool = True
    hidden: bool  # 이번 신고로(또는 이미) 가려졌는지


# --------------------------------------------------------------------------- #
# 차단
# --------------------------------------------------------------------------- #
class BlockedUserOut(BaseModel):
    user_id: int
    nickname: str | None  # 닉네임이 없으면 null(이메일로 대신하지 않는다 — 상대 이메일 노출 방지)
    blocked_at: datetime


# --------------------------------------------------------------------------- #
# 관리자 — 신고 관리
# --------------------------------------------------------------------------- #
class ReportedCommentOut(BaseModel):
    """신고된 댓글 1건(신고들을 댓글 단위로 묶음)."""

    comment_id: int
    content: str
    post_id: int
    post_title: str
    author_id: int
    author_nickname: str | None
    author_comment_banned: bool
    report_count: int
    reason_counts: dict[str, int]
    last_reported_at: datetime
    hidden: bool


class ResolveRequest(BaseModel):
    action: ResolveAction


class ResolveResult(BaseModel):
    ok: bool = True
    action: ResolveAction


# --------------------------------------------------------------------------- #
# 관리자 — 회원
# --------------------------------------------------------------------------- #
class AdminUserOut(BaseModel):
    id: int
    email: str | None
    nickname: str | None
    role: UserRole
    provider: AuthProvider | None
    is_active: bool
    comment_banned: bool
    comment_banned_at: datetime | None
    created_at: datetime


class AdminUserListOut(BaseModel):
    total: int
    page: int
    size: int
    items: list[AdminUserOut]


class CommentBanRequest(BaseModel):
    banned: bool


class NicknameUpdate(BaseModel):
    nickname: str = Field(..., description="1~20자(앞뒤 공백 제거 후). 금칙어 검사는 하지 않는다 — 관리자 판단")

    @field_validator("nickname")
    @classmethod
    def _strip_len(cls, v: str) -> str:
        v = v.strip()
        if not (NICKNAME_MIN <= len(v) <= NICKNAME_MAX):
            raise ValueError(f"닉네임은 {NICKNAME_MIN}~{NICKNAME_MAX}자여야 합니다.")
        return v

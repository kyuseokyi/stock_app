"""블로그 API 입출력 Pydantic 스키마 (DTO)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from shared.models import UserRole


# --------------------------------------------------------------------------- #
# Board (게시판)
# --------------------------------------------------------------------------- #
class BoardBase(BaseModel):
    name: str = Field(..., max_length=100, description="게시판 이름")
    order_index: int = Field(0, description="정렬 순서")
    is_active: bool = Field(True, description="활성 여부")
    min_role_required: UserRole = Field(
        UserRole.FREE, description="접근 최소 권한"
    )


class BoardCreate(BoardBase):
    pass


class BoardUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    order_index: int | None = None
    is_active: bool | None = None
    min_role_required: UserRole | None = None


class BoardOut(BoardBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------- #
# Blog Post (게시글)
# --------------------------------------------------------------------------- #
class BlogBase(BaseModel):
    board_id: int = Field(..., description="소속 게시판 ID")
    title: str = Field(..., max_length=255, description="제목")
    content: str = Field(..., description="본문(HTML)")
    thumbnail_url: str | None = Field(None, max_length=512)


class BlogCreate(BlogBase):
    author_id: int | None = Field(None, description="작성자 ID (선택)")


class BlogUpdate(BaseModel):
    board_id: int | None = None
    title: str | None = Field(None, max_length=255)
    content: str | None = None
    thumbnail_url: str | None = Field(None, max_length=512)


class BlogOut(BlogBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int | None
    view_count: int
    created_at: datetime
    updated_at: datetime


class BlogListOut(BaseModel):
    """페이지네이션된 게시글 목록."""

    total: int
    page: int
    size: int
    items: list[BlogOut]


# --------------------------------------------------------------------------- #
# Comment (댓글)
# --------------------------------------------------------------------------- #
class CommentCreate(BaseModel):
    content: str = Field(..., description="댓글 내용")


class CommentUpdate(BaseModel):
    content: str = Field(..., description="댓글 내용")


class CommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    post_id: int
    author_id: int | None
    author_name: str | None = None
    content: str
    created_at: datetime
    updated_at: datetime

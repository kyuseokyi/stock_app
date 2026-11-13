"""블로그 댓글(comments) REST 라우터.

목록/작성은 게시글 하위 경로(/blogs/{blog_id}/comments),
수정/삭제/신고는 댓글 단건 경로(/comments/{comment_id})로 제공한다.
목록은 선택 인증 — 토큰이 있으면 차단·본인 신고 댓글을 빼고 is_mine 을 채운다(services/moderation).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user, get_optional_user
from shared.database import get_db
from apps.auth.terms import terms_required
from shared.models import BlogComment, User, UserRole

from .. import crud, moderation_schemas, schemas
from ..services import moderation

router = APIRouter(prefix="/api/v1", tags=["comments"])


def _to_out(c: BlogComment, viewer: User | None = None) -> schemas.CommentOut:
    return moderation.to_out(c, viewer)


def _raise(e: moderation.ModerationError) -> None:
    raise HTTPException(e.status_code, detail={"code": e.code, "message": e.message}) from e


@router.get("/blogs/{blog_id}/comments", response_model=list[schemas.CommentOut])
async def list_comments(
    blog_id: int,
    db: AsyncSession = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
):
    if await crud.get_blog(db, blog_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    return await moderation.list_comments(db, blog_id, viewer)


@router.post(
    "/blogs/{blog_id}/comments",
    response_model=schemas.CommentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    blog_id: int,
    payload: schemas.CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # UGC 요건 — 약관 미동의 회원은 댓글 작성 불가(클라이언트 게이트 우회 방지). 관리자는 terms_required=False
    if terms_required(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "TERMS_REQUIRED", "message": "이용약관에 동의해야 댓글을 쓸 수 있어요."},
        )
    try:
        moderation.ensure_can_write(user)  # 작성 금지 회원 — 403 COMMENT_BANNED
    except moderation.ModerationError as e:
        _raise(e)
    post = await crud.get_blog(db, blog_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    board = await crud.get_board(db, post.board_id)
    if board is not None and not board.comments_enabled:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "댓글이 비활성화된 게시판입니다."
        )
    comment = await crud.create_comment(
        db, post_id=blog_id, author_id=user.id, content=payload.content
    )
    return _to_out(comment, user)


def _ensure_can_modify(comment: BlogComment, user: User) -> None:
    if user.role != UserRole.ADMIN and comment.author_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다.")


@router.put("/comments/{comment_id}", response_model=schemas.CommentOut)
async def update_comment(
    comment_id: int,
    payload: schemas.CommentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await crud.get_comment(db, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "댓글을 찾을 수 없습니다.")
    _ensure_can_modify(comment, user)
    try:
        moderation.ensure_can_write(user)  # 작성 금지 회원은 수정도 막는다(삭제는 허용)
    except moderation.ModerationError as e:
        _raise(e)
    return _to_out(await crud.update_comment(db, comment, payload.content), user)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = await crud.get_comment(db, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "댓글을 찾을 수 없습니다.")
    _ensure_can_modify(comment, user)
    await crud.delete_comment(db, comment)


@router.post(
    "/comments/{comment_id}/reports",
    response_model=moderation_schemas.ReportResult,
    status_code=status.HTTP_201_CREATED,
)
async def report_comment(
    comment_id: int,
    payload: moderation_schemas.ReportCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """댓글 신고 — 자기 댓글 400 CANNOT_REPORT_OWN, 중복 409 ALREADY_REPORTED, 기타 사유 내용 누락 422."""
    try:
        return await moderation.report_comment(db, comment_id, user, payload)
    except moderation.ModerationError as e:
        _raise(e)

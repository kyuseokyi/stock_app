"""블로그 댓글(comments) REST 라우터.

목록/작성은 게시글 하위 경로(/blogs/{blog_id}/comments),
수정/삭제는 댓글 단건 경로(/comments/{comment_id})로 제공한다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import BlogComment, User, UserRole

from .. import crud, schemas

router = APIRouter(prefix="/api/v1", tags=["comments"])


def _to_out(c: BlogComment) -> schemas.CommentOut:
    author_name = None
    if c.author is not None:
        author_name = c.author.nickname or c.author.email
    return schemas.CommentOut(
        id=c.id,
        post_id=c.post_id,
        author_id=c.author_id,
        author_name=author_name,
        content=c.content,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get("/blogs/{blog_id}/comments", response_model=list[schemas.CommentOut])
async def list_comments(blog_id: int, db: AsyncSession = Depends(get_db)):
    if await crud.get_blog(db, blog_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    return [_to_out(c) for c in await crud.list_comments(db, blog_id)]


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
    if await crud.get_blog(db, blog_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    comment = await crud.create_comment(
        db, post_id=blog_id, author_id=user.id, content=payload.content
    )
    return _to_out(comment)


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
    return _to_out(await crud.update_comment(db, comment, payload.content))


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

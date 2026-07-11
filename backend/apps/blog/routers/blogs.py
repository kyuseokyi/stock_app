"""블로그 게시글(blogs) REST 라우터."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from .. import crud, schemas
from ..events import publish_event
from ..notifications import notify_new_post

router = APIRouter(prefix="/api/v1/blogs", tags=["blogs"])


@router.get("", response_model=schemas.BlogListOut)
async def read_blogs(
    board_id: int | None = Query(None, description="게시판 ID로 필터"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    total, items = await crud.list_blogs(db, board_id=board_id, page=page, size=size)
    return schemas.BlogListOut(total=total, page=page, size=size, items=items)


@router.post("", response_model=schemas.BlogOut, status_code=status.HTTP_201_CREATED)
async def create_blog(
    payload: schemas.BlogCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if await crud.get_board(db, payload.board_id) is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "존재하지 않는 게시판입니다."
        )
    # 작성자는 항상 인증된 관리자로 연결한다.
    payload.author_id = admin.id
    post = await crud.create_blog(db, payload)
    # (모바일) 새 글 알림을 Celery 워커로 위임 — FCM 발송
    notify_new_post(post.id)
    # (웹) SSE 스트림으로 즉시 알림 이벤트 발행
    await publish_event(
        {
            "type": "new_post",
            "post_id": post.id,
            "board_id": post.board_id,
            "title": post.title,
        }
    )
    return post


@router.get("/{blog_id}", response_model=schemas.BlogOut)
async def read_blog(blog_id: int, db: AsyncSession = Depends(get_db)):
    post = await crud.get_blog(db, blog_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    return post


@router.put("/{blog_id}", response_model=schemas.BlogOut)
async def update_blog(
    blog_id: int,
    payload: schemas.BlogUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    post = await crud.get_blog(db, blog_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    if payload.board_id is not None and await crud.get_board(db, payload.board_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 게시판입니다.")
    return await crud.update_blog(db, post, payload)


@router.delete("/{blog_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_blog(
    blog_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    post = await crud.get_blog(db, blog_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시글을 찾을 수 없습니다.")
    await crud.delete_blog(db, post)

"""블로그 데이터 접근 계층 (async CRUD).

라우터는 이 모듈의 함수만 호출하고 SQLAlchemy 쿼리를 직접 다루지 않는다.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.models import Board, BlogComment, BlogPost

from . import schemas


# --------------------------------------------------------------------------- #
# Board
# --------------------------------------------------------------------------- #
async def list_boards(db: AsyncSession, *, only_active: bool = False) -> list[Board]:
    stmt = select(Board).order_by(Board.order_index, Board.id)
    if only_active:
        stmt = stmt.where(Board.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_board(db: AsyncSession, board_id: int) -> Board | None:
    return await db.get(Board, board_id)


async def create_board(db: AsyncSession, data: schemas.BoardCreate) -> Board:
    board = Board(**data.model_dump())
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return board


async def update_board(
    db: AsyncSession, board: Board, data: schemas.BoardUpdate
) -> Board:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(board, key, value)
    await db.commit()
    await db.refresh(board)
    return board


async def delete_board(db: AsyncSession, board: Board) -> None:
    await db.delete(board)
    await db.commit()


# --------------------------------------------------------------------------- #
# Blog Post
# --------------------------------------------------------------------------- #
async def list_blogs(
    db: AsyncSession,
    *,
    board_id: int | None = None,
    page: int = 1,
    size: int = 20,
) -> tuple[int, list[BlogPost]]:
    """(total, items) 페이지네이션 결과."""
    base = select(BlogPost)
    count_stmt = select(func.count()).select_from(BlogPost)
    if board_id is not None:
        base = base.where(BlogPost.board_id == board_id)
        count_stmt = count_stmt.where(BlogPost.board_id == board_id)

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = (
        base.order_by(BlogPost.created_at.desc(), BlogPost.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = list((await db.execute(stmt)).scalars().all())
    return total, items


async def get_blog(db: AsyncSession, blog_id: int) -> BlogPost | None:
    return await db.get(BlogPost, blog_id)


async def create_blog(db: AsyncSession, data: schemas.BlogCreate) -> BlogPost:
    post = BlogPost(**data.model_dump())
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


async def update_blog(
    db: AsyncSession, post: BlogPost, data: schemas.BlogUpdate
) -> BlogPost:
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(post, key, value)
    await db.commit()
    await db.refresh(post)
    return post


async def delete_blog(db: AsyncSession, post: BlogPost) -> None:
    await db.delete(post)
    await db.commit()


# --------------------------------------------------------------------------- #
# Comment
# --------------------------------------------------------------------------- #
async def list_comments(db: AsyncSession, post_id: int) -> list[BlogComment]:
    stmt = (
        select(BlogComment)
        .where(BlogComment.post_id == post_id)
        .options(selectinload(BlogComment.author))
        .order_by(BlogComment.created_at.asc(), BlogComment.id.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_comment(db: AsyncSession, comment_id: int) -> BlogComment | None:
    stmt = (
        select(BlogComment)
        .where(BlogComment.id == comment_id)
        .options(selectinload(BlogComment.author))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def create_comment(
    db: AsyncSession, *, post_id: int, author_id: int, content: str
) -> BlogComment:
    comment = BlogComment(post_id=post_id, author_id=author_id, content=content)
    db.add(comment)
    await db.commit()
    # author 관계를 로드한 상태로 반환
    return await get_comment(db, comment.id)


async def update_comment(
    db: AsyncSession, comment: BlogComment, content: str
) -> BlogComment:
    comment.content = content
    await db.commit()
    return await get_comment(db, comment.id)


async def delete_comment(db: AsyncSession, comment: BlogComment) -> None:
    await db.delete(comment)
    await db.commit()

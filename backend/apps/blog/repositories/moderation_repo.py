"""댓글 신고·차단·작성 금지·회원 관리 DB 접근(async). 커밋은 서비스가 한다(여러 단계를 한 번에 확정)."""
from __future__ import annotations

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import BlogComment, BlogPost, CommentReport, User, UserBlock


# --------------------------------------------------------------------------- #
# 조회 보조
# --------------------------------------------------------------------------- #
async def get_user(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def blocked_ids(db: AsyncSession, blocker_id: int) -> set[int]:
    rows = await db.execute(select(UserBlock.blocked_id).where(UserBlock.blocker_id == blocker_id))
    return set(rows.scalars().all())


async def reported_comment_ids(db: AsyncSession, reporter_id: int, post_id: int) -> set[int]:
    """reporter 가 이 게시글에서 신고한 댓글 id(상태 무관 — 신고자 본인에게는 계속 빠진다)."""
    stmt = (
        select(CommentReport.comment_id)
        .join(BlogComment, BlogComment.id == CommentReport.comment_id)
        .where(CommentReport.reporter_id == reporter_id, BlogComment.post_id == post_id)
    )
    return set((await db.execute(stmt)).scalars().all())


# --------------------------------------------------------------------------- #
# 신고
# --------------------------------------------------------------------------- #
async def has_report(db: AsyncSession, comment_id: int, reporter_id: int) -> bool:
    stmt = select(CommentReport.id).where(
        CommentReport.comment_id == comment_id, CommentReport.reporter_id == reporter_id
    )
    return (await db.execute(stmt)).first() is not None


async def add_report(db: AsyncSession, *, comment_id: int, reporter_id: int, reason: str,
                     detail: str | None) -> None:
    """flush 까지만 — UNIQUE 위반(IntegrityError)은 호출자가 처리한다."""
    db.add(CommentReport(comment_id=comment_id, reporter_id=reporter_id, reason=reason, detail=detail))
    await db.flush()


async def count_pending_reporters(db: AsyncSession, comment_id: int) -> int:
    """대기(pending) 신고의 서로 다른 신고자 수. 기각된 신고는 세지 않는다."""
    stmt = select(func.count(func.distinct(CommentReport.reporter_id))).where(
        CommentReport.comment_id == comment_id, CommentReport.status == "pending"
    )
    return int((await db.execute(stmt)).scalar_one())


async def set_reports_status(db: AsyncSession, comment_id: int, *, from_status: str, to_status: str) -> None:
    await db.execute(
        update(CommentReport)
        .where(CommentReport.comment_id == comment_id, CommentReport.status == from_status)
        .values(status=to_status)
    )


async def reported_comment_rows(db: AsyncSession, status: str | None) -> list:
    """(댓글 × 사유) 단위 집계 행. status=None 이면 전체 상태.

    댓글·게시글·작성자와 inner join — 이미 지워진 댓글의 신고는 나오지 않는다.
    """
    stmt = (
        select(
            BlogComment.id.label("comment_id"),
            BlogComment.content,
            BlogComment.post_id,
            BlogPost.title.label("post_title"),
            BlogComment.author_id,
            User.nickname.label("author_nickname"),
            User.comment_banned_at,
            BlogComment.hidden_at,
            CommentReport.reason,
            func.count(CommentReport.id).label("n"),
            func.max(CommentReport.created_at).label("last_at"),
        )
        .join(BlogComment, BlogComment.id == CommentReport.comment_id)
        .join(BlogPost, BlogPost.id == BlogComment.post_id)
        .join(User, User.id == BlogComment.author_id)
        .group_by(
            BlogComment.id, BlogComment.content, BlogComment.post_id, BlogPost.title, BlogComment.author_id,
            User.nickname, User.comment_banned_at, BlogComment.hidden_at, CommentReport.reason,
        )
    )
    if status is not None:
        stmt = stmt.where(CommentReport.status == status)
    return list((await db.execute(stmt)).all())


# --------------------------------------------------------------------------- #
# 차단
# --------------------------------------------------------------------------- #
async def get_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> UserBlock | None:
    return await db.get(UserBlock, (blocker_id, blocked_id))


async def add_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> None:
    db.add(UserBlock(blocker_id=blocker_id, blocked_id=blocked_id))
    await db.flush()


async def delete_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> None:
    await db.execute(
        delete(UserBlock).where(UserBlock.blocker_id == blocker_id, UserBlock.blocked_id == blocked_id)
    )


async def list_blocks(db: AsyncSession, blocker_id: int) -> list:
    """[(blocked_id, nickname, created_at)] 최신순."""
    stmt = (
        select(UserBlock.blocked_id, User.nickname, UserBlock.created_at)
        .join(User, User.id == UserBlock.blocked_id)
        .where(UserBlock.blocker_id == blocker_id)
        .order_by(UserBlock.created_at.desc(), UserBlock.blocked_id.desc())
    )
    return list((await db.execute(stmt)).all())


# --------------------------------------------------------------------------- #
# 회원(관리자)
# --------------------------------------------------------------------------- #
async def list_users(db: AsyncSession, *, q: str | None, page: int, size: int) -> tuple[int, list[User]]:
    base = select(User)
    count_stmt = select(func.count()).select_from(User)
    if q:
        like = f"%{q}%"
        cond = or_(User.nickname.ilike(like), User.email.ilike(like))
        base = base.where(cond)
        count_stmt = count_stmt.where(cond)
    total = int((await db.execute(count_stmt)).scalar_one())
    stmt = base.order_by(User.id.desc()).offset((page - 1) * size).limit(size)
    return total, list((await db.execute(stmt)).scalars().all())


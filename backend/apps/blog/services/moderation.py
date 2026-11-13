"""댓글 신고·차단·작성 금지·회원 관리(관리자) 규칙.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §2·§3
- 숨김: 대기(pending) 신고의 서로 다른 신고자 수가 COMMENT_HIDE_THRESHOLD(env, 기본 3) 이상이 되는 순간 hidden_at=now.
  기각된 신고는 세지 않는다(UNIQUE 때문에 기각된 신고자는 다시 신고할 수 없어, 세면 기각이 무의미해진다).
- 목록: 요청자가 차단한 사람의 댓글·요청자가 신고한 댓글을 뺀다. 가려진 댓글은 관리자 외에는 내용·작성자 이름을 지운다.
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import BlogComment, User, UserRole

from .. import crud, moderation_schemas as ms, schemas
from ..repositories import moderation_repo as repo

DEFAULT_HIDE_THRESHOLD = 3
ADMIN_REPORT_LIMIT_MAX = 500


class ModerationError(Exception):
    """라우터가 HTTPException(status, {code, message}) 로 바꾼다."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def hide_threshold() -> int:
    """호출 시점에 env 를 읽는다(테스트 monkeypatch 가능). 비었거나 잘못된 값이면 기본 3, 최소 1."""
    raw = (os.getenv("COMMENT_HIDE_THRESHOLD") or "").strip()
    try:
        return max(1, int(raw)) if raw else DEFAULT_HIDE_THRESHOLD
    except ValueError:
        return DEFAULT_HIDE_THRESHOLD


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_admin(user: User | None) -> bool:
    return user is not None and user.role == UserRole.ADMIN


# --------------------------------------------------------------------------- #
# 댓글 출력·목록
# --------------------------------------------------------------------------- #
def to_out(c: BlogComment, viewer: User | None) -> schemas.CommentOut:
    """기존 필드는 그대로 두고 hidden·is_mine 만 더한다. 가려진 댓글은 관리자 외에는 내용·작성자 이름을 지운다."""
    hidden = c.hidden_at is not None
    author_name = None
    if c.author is not None:
        author_name = c.author.nickname or c.author.email
    content = c.content
    if hidden and not _is_admin(viewer):
        content, author_name = "", None
    return schemas.CommentOut(
        id=c.id,
        post_id=c.post_id,
        author_id=c.author_id,
        author_name=author_name,
        content=content,
        created_at=c.created_at,
        updated_at=c.updated_at,
        hidden=hidden,
        is_mine=viewer is not None and c.author_id == viewer.id,
    )


async def list_comments(db: AsyncSession, post_id: int, viewer: User | None) -> list[schemas.CommentOut]:
    comments = await crud.list_comments(db, post_id)
    if viewer is not None:
        blocked = await repo.blocked_ids(db, viewer.id)
        reported = await repo.reported_comment_ids(db, viewer.id, post_id)
        comments = [c for c in comments if c.author_id not in blocked and c.id not in reported]
    return [to_out(c, viewer) for c in comments]


def ensure_can_write(user: User) -> None:
    """댓글 작성·수정 전 — 작성 금지 회원이면 403 COMMENT_BANNED(삭제는 막지 않는다)."""
    if user.comment_banned_at is not None:
        raise ModerationError(403, "COMMENT_BANNED", "운영 정책 위반으로 댓글을 쓸 수 없어요.")


# --------------------------------------------------------------------------- #
# 신고
# --------------------------------------------------------------------------- #
async def report_comment(db: AsyncSession, comment_id: int, reporter: User,
                         data: ms.ReportCreate) -> ms.ReportResult:
    comment = await crud.get_comment(db, comment_id)
    if comment is None:
        raise ModerationError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    if comment.author_id == reporter.id:
        raise ModerationError(400, "CANNOT_REPORT_OWN", "내 댓글은 신고할 수 없어요.")
    if await repo.has_report(db, comment_id, reporter.id):
        raise ModerationError(409, "ALREADY_REPORTED", "이미 신고한 댓글이에요.")
    try:
        await repo.add_report(db, comment_id=comment_id, reporter_id=reporter.id, reason=data.reason,
                              detail=data.detail)
    except IntegrityError:  # 같은 사람의 동시 신고 — UNIQUE 위반
        await db.rollback()
        raise ModerationError(409, "ALREADY_REPORTED", "이미 신고한 댓글이에요.")

    if comment.hidden_at is None and await repo.count_pending_reporters(db, comment_id) >= hide_threshold():
        comment.hidden_at = _now()
    hidden = comment.hidden_at is not None
    await db.commit()
    return ms.ReportResult(hidden=hidden)


# --------------------------------------------------------------------------- #
# 차단
# --------------------------------------------------------------------------- #
async def block_user(db: AsyncSession, blocker: User, blocked_id: int) -> bool:
    """새로 차단했으면 True, 이미 차단이면 False(멱등)."""
    if blocked_id == blocker.id:
        raise ModerationError(400, "CANNOT_BLOCK_SELF", "나 자신은 차단할 수 없어요.")
    target = await repo.get_user(db, blocked_id)
    if target is None:
        raise ModerationError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    if target.role == UserRole.ADMIN:
        raise ModerationError(400, "CANNOT_BLOCK_ADMIN", "운영자는 차단할 수 없어요.")
    if await repo.get_block(db, blocker.id, blocked_id) is not None:
        return False
    try:
        await repo.add_block(db, blocker.id, blocked_id)
        await db.commit()
    except IntegrityError:  # 동시 요청 — 이미 차단된 것과 같다
        await db.rollback()
        return False
    return True


async def unblock_user(db: AsyncSession, blocker: User, blocked_id: int) -> None:
    await repo.delete_block(db, blocker.id, blocked_id)
    await db.commit()


async def list_blocks(db: AsyncSession, blocker: User) -> list[ms.BlockedUserOut]:
    return [ms.BlockedUserOut(user_id=uid, nickname=nick, blocked_at=at)
            for uid, nick, at in await repo.list_blocks(db, blocker.id)]


# --------------------------------------------------------------------------- #
# 관리자 — 신고 관리
# --------------------------------------------------------------------------- #
async def admin_list_reports(db: AsyncSession, status: str, limit: int) -> list[ms.ReportedCommentOut]:
    """신고를 댓글 단위로 묶어 최근 신고순. status='all' 이면 상태 무관."""
    rows = await repo.reported_comment_rows(db, None if status == "all" else status)
    grouped: dict[int, dict] = {}
    reasons: dict[int, dict[str, int]] = defaultdict(dict)
    for r in rows:
        g = grouped.get(r.comment_id)
        if g is None:
            g = grouped[r.comment_id] = {
                "comment_id": r.comment_id, "content": r.content, "post_id": r.post_id,
                "post_title": r.post_title, "author_id": r.author_id, "author_nickname": r.author_nickname,
                "author_comment_banned": r.comment_banned_at is not None, "report_count": 0,
                "last_reported_at": r.last_at, "hidden": r.hidden_at is not None,
            }
        g["report_count"] += int(r.n)
        reasons[r.comment_id][r.reason] = int(r.n)
        if r.last_at is not None and (g["last_reported_at"] is None or r.last_at > g["last_reported_at"]):
            g["last_reported_at"] = r.last_at
    items = [ms.ReportedCommentOut(**g, reason_counts=reasons[cid]) for cid, g in grouped.items()]
    items.sort(key=lambda x: (x.last_reported_at, x.comment_id), reverse=True)
    return items[: max(1, min(limit, ADMIN_REPORT_LIMIT_MAX))]


def _ban_value(banned: bool, current: datetime | None) -> datetime | None:
    """금지 켜기: 이미 금지면 최초 시각 유지. 끄기: NULL."""
    if not banned:
        return None
    return current or _now()


async def resolve_report(db: AsyncSession, comment_id: int, action: str) -> None:
    """delete=댓글 삭제 / dismiss=숨김 해제 + 대기 신고 기각 / ban_author=작성자 댓글 금지 + 댓글 삭제."""
    comment = await crud.get_comment(db, comment_id)
    if comment is None:
        raise ModerationError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    if action == "dismiss":
        comment.hidden_at = None
        await repo.set_reports_status(db, comment_id, from_status="pending", to_status="dismissed")
        await db.commit()
        return
    if action == "ban_author":
        author = comment.author
        if author is not None and author.role == UserRole.ADMIN:
            raise ModerationError(400, "CANNOT_BAN_ADMIN", "운영자는 댓글 금지할 수 없어요.")
        if author is not None:
            author.comment_banned_at = _ban_value(True, author.comment_banned_at)
    # 신고를 처리됨으로 남긴 뒤 댓글을 지운다(운영 DB 는 FK CASCADE 로 신고 행도 함께 지워진다)
    await repo.set_reports_status(db, comment_id, from_status="pending", to_status="actioned")
    await db.delete(comment)
    await db.commit()


# --------------------------------------------------------------------------- #
# 관리자 — 회원
# --------------------------------------------------------------------------- #
def admin_user_out(u: User) -> ms.AdminUserOut:
    return ms.AdminUserOut(
        id=u.id, email=u.email, nickname=u.nickname, role=u.role, provider=u.provider, is_active=u.is_active,
        comment_banned=u.comment_banned_at is not None, comment_banned_at=u.comment_banned_at,
        created_at=u.created_at,
    )


async def admin_list_users(db: AsyncSession, q: str | None, page: int, size: int) -> ms.AdminUserListOut:
    total, users = await repo.list_users(db, q=(q or "").strip() or None, page=page, size=size)
    return ms.AdminUserListOut(total=total, page=page, size=size, items=[admin_user_out(u) for u in users])


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    user = await repo.get_user(db, user_id)
    if user is None:
        raise ModerationError(404, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    return user


async def set_comment_ban(db: AsyncSession, user_id: int, banned: bool) -> ms.AdminUserOut:
    user = await _get_user_or_404(db, user_id)
    if banned and user.role == UserRole.ADMIN:
        raise ModerationError(400, "CANNOT_BAN_ADMIN", "운영자는 댓글 금지할 수 없어요.")
    user.comment_banned_at = _ban_value(banned, user.comment_banned_at)
    await db.commit()
    await db.refresh(user)
    return admin_user_out(user)


async def set_nickname(db: AsyncSession, user_id: int, nickname: str) -> ms.AdminUserOut:
    """관리자 강제 변경 — 금칙어 검사는 하지 않는다(관리자 판단)."""
    user = await _get_user_or_404(db, user_id)
    user.nickname = nickname
    await db.commit()
    await db.refresh(user)
    return admin_user_out(user)

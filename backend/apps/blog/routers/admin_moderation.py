"""관리자 — 댓글 신고 관리·회원(닉네임 변경·댓글 금지) REST 라우터. 모두 require_admin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from .. import moderation_schemas as ms
from ..services import moderation

router = APIRouter(prefix="/api/v1/admin", tags=["admin-moderation"])


def _http(e: moderation.ModerationError) -> HTTPException:
    return HTTPException(e.status_code, detail={"code": e.code, "message": e.message})


# ---------------------------------------------------------------- 신고 관리
@router.get("/comment-reports", response_model=list[ms.ReportedCommentOut])
async def list_comment_reports(
    status: ms.ReportStatusFilter = Query("pending", description="pending(대기) | dismissed | actioned | all"),
    limit: int = Query(200, ge=1, le=moderation.ADMIN_REPORT_LIMIT_MAX),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """신고를 댓글 단위로 묶어 최근 신고순."""
    return await moderation.admin_list_reports(db, status, limit)


@router.post("/comment-reports/{comment_id}/resolve", response_model=ms.ResolveResult)
async def resolve_comment_report(
    comment_id: int,
    payload: ms.ResolveRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """delete(댓글 삭제) | dismiss(숨김 해제 + 신고 기각) | ban_author(작성자 댓글 금지 + 댓글 삭제)."""
    try:
        await moderation.resolve_report(db, comment_id, payload.action)
    except moderation.ModerationError as e:
        raise _http(e) from e
    return ms.ResolveResult(action=payload.action)


# ---------------------------------------------------------------- 회원
@router.get("/users", response_model=ms.AdminUserListOut)
async def list_users(
    q: str | None = Query(None, max_length=100, description="닉네임·이메일 부분 검색"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """회원 목록(최근 가입순) — 어드민 회원 화면용."""
    return await moderation.admin_list_users(db, q, page, size)


@router.patch("/users/{user_id}/comment-ban", response_model=ms.AdminUserOut)
async def set_comment_ban(
    user_id: int,
    payload: ms.CommentBanRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """댓글 작성 금지 켜기·끄기. 운영자 금지는 400."""
    try:
        return await moderation.set_comment_ban(db, user_id, payload.banned)
    except moderation.ModerationError as e:
        raise _http(e) from e


@router.patch("/users/{user_id}/nickname", response_model=ms.AdminUserOut)
async def set_nickname(
    user_id: int,
    payload: ms.NicknameUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """관리자 닉네임 강제 변경(1~20자, 금칙어 검사 없음)."""
    try:
        return await moderation.set_nickname(db, user_id, payload.nickname)
    except moderation.ModerationError as e:
        raise _http(e) from e

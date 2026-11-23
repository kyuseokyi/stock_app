"""관리자 — 댓글 신고 관리·회원(닉네임 변경·댓글 금지·시세 열람 권한)·차트 포함 글 점검 REST 라우터. 모두 require_admin."""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from .. import moderation_schemas as ms
from ..services import chart_audit, moderation

log = logging.getLogger("blog.admin_moderation")
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
    q: str | None = Query(None, max_length=100, description="닉네임·이메일 부분 검색, 숫자(앞 # 허용)면 회원 번호 일치도"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    market_data_access: bool | None = Query(None, description="true 면 시세 열람 권한이 있는 회원만"),
    provider: Literal["KAKAO", "NAVER", "GOOGLE", "APPLE", "LOCAL"] | None = Query(
        None, description="로그인 방식 필터 — LOCAL 은 공급자 없는 계정(관리자·게스트·심사)"),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """회원 목록(최근 가입순) — 어드민 회원 화면용."""
    return await moderation.admin_list_users(db, q, page, size, market_data_access, provider)


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


@router.patch("/users/{user_id}/market-data-access", response_model=ms.AdminUserOut)
async def set_market_data_access(
    user_id: int,
    payload: ms.MarketDataAccessRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """회원별 시세 열람 권한 켜기·끄기(A안 — 운영자 본인 확인용). 관리자 대상은 400(항상 허용)."""
    try:
        out = await moderation.set_market_data_access(db, user_id, payload.enabled)
    except moderation.ModerationError as e:
        raise _http(e) from e
    log.info("시세 열람 권한 변경 user=%s enabled=%s admin=%s", user_id, payload.enabled, admin.id)
    return out


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


# ---------------------------------------------------------------- 차트 포함 글 점검
@router.get("/blog/chart-posts", response_model=list[ms.ChartPostOut])
async def list_chart_posts(
    limit: int = Query(200, ge=1, le=chart_audit.CHART_POSTS_LIMIT_MAX),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """차트 스냅샷·내장 이미지가 들어간 글 목록(최신순, 조회 전용). 정리는 관리자가 편집 화면에서 직접 한다."""
    return await chart_audit.list_chart_posts(db, limit)

"""차트 퀴즈 관리자 API (백로그 ⑤-2) — 목록·상세·수정·삭제·일괄 생성·직접 출제."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import (
    QuizAdminDetail, QuizAdminItem, QuizAdminListResponse, QuizAdminUpdate, QuizCreateRequest,
    QuizGenerateRequest, QuizGenerateResponse,
)
from apps.trading_game.services import quiz_admin_service
from apps.trading_game.services.quiz_admin_service import QuizAdminError, QuizWithAttempts

log = logging.getLogger("trading_game.quiz_admin")
router = APIRouter(prefix="/api/game/admin/quizzes", tags=["trading-game-admin"])

_ERROR_STATUS = {
    "NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "HAS_ATTEMPTS": status.HTTP_409_CONFLICT,
    "DUPLICATE": status.HTTP_409_CONFLICT,
    "INSUFFICIENT_DATA": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "TOO_FLAT": status.HTTP_422_UNPROCESSABLE_CONTENT,
    "INVALID_SERIES": status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _http(e: QuizAdminError) -> HTTPException:
    return HTTPException(_ERROR_STATUS[e.code], detail={"code": e.code, "message": str(e)})


def _item_fields(r: QuizWithAttempts) -> dict:
    q = r.quiz
    return dict(
        id=q.id, ticker=q.ticker, base_date=q.base_date, pattern_type=q.pattern_type, answer=q.answer,
        actual_change=q.actual_change, is_active=q.is_active, attempt_count=r.attempt_count,
        created_at=q.created_at,
    )


def _detail(r: QuizWithAttempts) -> QuizAdminDetail:
    q = r.quiz
    return QuizAdminDetail(
        **_item_fields(r), explanation=q.explanation, reward_cash=q.reward_cash, chart_snapshot=q.chart_snapshot,
    )


@router.get("", response_model=QuizAdminListResponse)
async def list_quizzes(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    active: bool | None = None,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows, total = await quiz_admin_service.list_quizzes(db, page=page, size=size, active=active)
    return QuizAdminListResponse(
        items=[QuizAdminItem(**_item_fields(r)) for r in rows], total=total, page=page, size=size,
    )


@router.post("", response_model=QuizAdminDetail, status_code=status.HTTP_201_CREATED)
async def create_quiz(
    body: QuizCreateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await quiz_admin_service.create_quiz(db, body.ticker, body.base_date)
    except QuizAdminError as e:
        raise _http(e)
    log.info("퀴즈 직접 출제 id=%s ticker=%s base=%s admin=%s", row.quiz.id, body.ticker, body.base_date, admin.id)
    return _detail(row)


@router.post("/generate", response_model=QuizGenerateResponse)
async def generate_quizzes(
    body: QuizGenerateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    created, skipped = await quiz_admin_service.generate_quizzes(db, body.count)
    log.info("퀴즈 일괄 생성 count=%s created=%s skipped=%s admin=%s", body.count, created, skipped, admin.id)
    return QuizGenerateResponse(created=created, skipped=skipped)


@router.get("/{quiz_id}", response_model=QuizAdminDetail)
async def get_quiz(
    quiz_id: int,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        return _detail(await quiz_admin_service.get_quiz(db, quiz_id))
    except QuizAdminError as e:
        raise _http(e)


@router.put("/{quiz_id}", response_model=QuizAdminDetail)
async def update_quiz(
    quiz_id: int,
    body: QuizAdminUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await quiz_admin_service.update_quiz(db, quiz_id, body.model_dump(exclude_unset=True))
    except QuizAdminError as e:
        raise _http(e)
    log.info("퀴즈 수정 id=%s admin=%s", quiz_id, admin.id)
    return _detail(row)


@router.delete("/{quiz_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quiz(
    quiz_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        await quiz_admin_service.delete_quiz(db, quiz_id)
    except QuizAdminError as e:
        raise _http(e)
    log.info("퀴즈 삭제 id=%s admin=%s", quiz_id, admin.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

"""아카데미 문항 관리자 API (백로그 ⑤-2) — 목록(비활성 포함)·생성·수정·삭제."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import AcademyQuestionAdminDTO, AcademyQuestionUpsert
from apps.trading_game.services import academy_service

log = logging.getLogger("trading_game.academy_admin")
router = APIRouter(prefix="/api/game/admin/academy", tags=["trading-game-admin"])


def _dto(q) -> AcademyQuestionAdminDTO:
    return AcademyQuestionAdminDTO(
        id=q.id, question=q.question, choices=list(q.choices), answer=q.answer, explanation=q.explanation,
        sort_order=q.sort_order, is_active=q.is_active, created_at=q.created_at, updated_at=q.updated_at,
    )


def _http(e: academy_service.AcademyError) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": e.code, "message": str(e)})


@router.get("/questions", response_model=list[AcademyQuestionAdminDTO])
async def list_questions(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return [_dto(q) for q in await academy_service.list_all(db)]


@router.post("/questions", response_model=AcademyQuestionAdminDTO, status_code=status.HTTP_201_CREATED)
async def create_question(
    body: AcademyQuestionUpsert,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    row = await academy_service.create_question(db, body.model_dump())
    log.info("아카데미 문항 생성 id=%s admin=%s", row.id, admin.id)
    return _dto(row)


@router.put("/questions/{question_id}", response_model=AcademyQuestionAdminDTO)
async def update_question(
    question_id: int,
    body: AcademyQuestionUpsert,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await academy_service.update_question(db, question_id, body.model_dump())
    except academy_service.AcademyError as e:
        raise _http(e)
    log.info("아카데미 문항 수정 id=%s admin=%s", question_id, admin.id)
    return _dto(row)


@router.delete("/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        await academy_service.delete_question(db, question_id)
    except academy_service.AcademyError as e:
        raise _http(e)
    log.info("아카데미 문항 삭제 id=%s admin=%s", question_id, admin.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

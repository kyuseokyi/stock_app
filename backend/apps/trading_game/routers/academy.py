"""아카데미(5배 레버리지 해금 퀴즈) REST (Phase 5b)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import (
    AcademyQuestionDTO, AcademyQuizResponse, AcademyResultItem, AcademySubmitRequest, AcademySubmitResponse,
)
from apps.trading_game.services import academy_service

router = APIRouter(prefix="/api/game/academy", tags=["trading-game-academy"])


@router.get("/quiz", response_model=AcademyQuizResponse)
async def academy_quiz(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return AcademyQuizResponse(
        unlocked=await academy_service.is_unlocked(db, user.id),
        questions=[
            AcademyQuestionDTO(id=q.id, question=q.question, choices=list(q.choices))
            for q in await academy_service.list_active(db)
        ],
    )


@router.post("/submit", response_model=AcademySubmitResponse)
async def academy_submit(
    body: AcademySubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        results, unlocked = await academy_service.submit(db, user.id, body.answers)
    except academy_service.AcademyError as e:  # NO_QUESTIONS — 활성 문항 없음
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": e.code, "message": str(e)})
    return AcademySubmitResponse(unlocked=unlocked, results=[AcademyResultItem(**r) for r in results])

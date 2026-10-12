"""단계별 퀘스트 REST (Phase 5b)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import (
    BadgeDTO, QuestClaimResponse, QuestListResponse, QuestResponse,
)
from apps.trading_game.services import quest_service

router = APIRouter(prefix="/api/game", tags=["trading-game-quest"])

_ERROR_STATUS = {
    "QUEST_NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "QUEST_NOT_COMPLETED": status.HTTP_409_CONFLICT,
    "ALREADY_CLAIMED": status.HTTP_409_CONFLICT,
    "NO_ACTIVE_SEASON": status.HTTP_409_CONFLICT,
}


def _quest_dto(q: quest_service.QuestDef, row) -> QuestResponse:
    return QuestResponse(
        code=q.code, title=q.title, description=q.description, target=q.target,
        progress=row.progress if row else 0,
        reward_cash=q.reward_cash, reward_badge=q.reward_badge,
        completed=bool(row and row.completed_at), claimed=bool(row and row.claimed_at),
    )


def _badge_dto(code: str, awarded_at) -> BadgeDTO:
    return BadgeDTO(code=code, name=quest_service.BADGE_NAMES.get(code, code), awarded_at=awarded_at)


@router.get("/quests", response_model=QuestListResponse)
async def my_quests(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pairs, badges = await quest_service.list_progress(db, user.id)
    return QuestListResponse(
        quests=[_quest_dto(q, row) for q, row in pairs],
        badges=[_badge_dto(b.badge_code, b.awarded_at) for b in badges],
    )


@router.post("/quests/{code}/claim", response_model=QuestClaimResponse)
async def claim_quest(
    code: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        row, account = await quest_service.claim(db, user.id, code)
    except quest_service.QuestError as e:
        raise HTTPException(_ERROR_STATUS[e.code], detail={"code": e.code, "message": str(e)})
    quest = quest_service.QUEST_BY_CODE[code]
    return QuestClaimResponse(
        quest=_quest_dto(quest, row),
        cash_balance=account.cash_balance if account else None,
        badge=_badge_dto(quest.reward_badge, row.claimed_at) if quest.reward_badge else None,
    )

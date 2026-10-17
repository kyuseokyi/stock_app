"""야간 차트 퀴즈 + 연속 출석 REST (Phase 5b) + 연속 출석 마일스톤 보상(백로그 ⑤-1)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import (
    QuizQuestionResponse, QuizSubmitRequest, QuizSubmitResponse, StreakResponse, StreakRewardClaimResponse,
    StreakRewardDTO,
)
from apps.trading_game.services import (
    feature_flag_service, position_cache, quiz_insight, quiz_service, streak_reward_service, streak_service,
)

router = APIRouter(prefix="/api/game", tags=["trading-game-quiz"])
log = logging.getLogger("trading_game.quiz")


_ERROR_STATUS = {
    "NO_QUIZ_AVAILABLE": status.HTTP_404_NOT_FOUND,
    "QUIZ_NOT_SERVED": status.HTTP_409_CONFLICT,
    "ALREADY_SUBMITTED": status.HTTP_409_CONFLICT,
}

_REWARD_ERROR_STATUS = {
    "UNKNOWN_MILESTONE": status.HTTP_404_NOT_FOUND,
    "FEATURE_DISABLED": status.HTTP_503_SERVICE_UNAVAILABLE,
    "NO_ACTIVE_SEASON": status.HTTP_409_CONFLICT,
    "NOT_REACHED": status.HTTP_409_CONFLICT,
    "ALREADY_CLAIMED": status.HTTP_409_CONFLICT,
    "PRICE_UNAVAILABLE": status.HTTP_409_CONFLICT,
}


async def _reward_dtos(db: AsyncSession, user_id: int) -> list[StreakRewardDTO]:
    """마일스톤 보상 상태(플래그 꺼짐·활성 시즌 없음이면 [])."""
    rewards = await streak_reward_service.reward_status(db, deps.get_redis(), user_id)
    return [
        StreakRewardDTO(milestone=r.milestone, amount=int(r.amount), claimed=r.claimed, claimable=r.claimable)
        for r in rewards
    ]


async def _streak_dto(db: AsyncSession, user_id: int, enabled: bool) -> StreakResponse:
    row = await streak_service.get_streak(db, user_id)
    return StreakResponse(
        current_streak=row.current_streak if row else 0,
        highest_streak=row.highest_streak if row else 0,
        last_activity_date=row.last_activity_date if row else None,
        enabled=enabled,
        rewards=await _reward_dtos(db, user_id),
    )


async def _require_quiz_enabled(db: AsyncSession) -> None:
    if not await feature_flag_service.is_enabled(db, deps.get_redis(), "QUIZ"):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "FEATURE_DISABLED", "message": "야간 차트 퀴즈는 현재 운영하지 않습니다."},
        )


@router.get("/quiz/random", response_model=QuizQuestionResponse)
async def random_quiz(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_quiz_enabled(db)
    try:
        quiz = await quiz_service.serve_random(db, user.id)
    except quiz_service.QuizError as e:
        raise HTTPException(_ERROR_STATUS.get(e.code, status.HTTP_400_BAD_REQUEST), detail={"code": e.code, "message": str(e)})
    return QuizQuestionResponse(
        id=quiz.id, chart_snapshot=quiz_service.masked_snapshot(quiz.chart_snapshot),
        time_limit_sec=quiz_service.QUIZ_TIME_LIMIT_SECONDS,
    )


@router.post("/quiz/{quiz_id}/submit", response_model=QuizSubmitResponse)
async def submit_quiz(
    quiz_id: int,
    body: QuizSubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_quiz_enabled(db)
    try:
        res = await quiz_service.submit(db, user.id, quiz_id, body.choice, redis=deps.get_redis())
    except quiz_service.QuizError as e:
        raise HTTPException(_ERROR_STATUS.get(e.code, status.HTTP_400_BAD_REQUEST), detail={"code": e.code, "message": str(e)})
    if res.rewarded:
        position_cache.mark_dirty()  # 보상 지급(현금·원금) → 실시간 랭킹 캐시 재적재
    quiz = res.quiz
    streak = None
    try:  # best-effort — 채점 결과는 항상 반환(rollback 하지 않음: quiz 속성 expire 방지)
        row = await streak_service.touch(db, deps.get_redis(), user.id)
        if row is not None:
            streak = StreakResponse(
                current_streak=row.current_streak, highest_streak=row.highest_streak,
                last_activity_date=row.last_activity_date, enabled=True,
            )
            streak.rewards = await _reward_dtos(db, user.id)  # 실패해도 streak 본체는 유지
    except Exception:
        log.warning("퀴즈 Streak 갱신 실패 user=%s", user.id, exc_info=True)
    return QuizSubmitResponse(
        correct=res.correct, answer=quiz.answer, actual_change=quiz.actual_change,
        pattern_type=quiz.pattern_type, explanation=quiz.explanation,
        rewarded=res.rewarded, reward_cash=quiz.reward_cash if res.rewarded else 0,
        timed_out=res.timed_out, ticker=quiz.ticker, base_date=quiz.base_date, streak=streak,
        future_snapshot=(
            quiz_service.masked_snapshot(quiz.future_snapshot, base=quiz.chart_snapshot)
            if quiz.future_snapshot else None
        ),
        outcome=quiz_insight.outcome_text(quiz.pattern_type, quiz.answer, quiz.actual_change),
    )


@router.get("/streak/my", response_model=StreakResponse)
async def my_streak(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await feature_flag_service.is_enabled(db, deps.get_redis(), "STREAK")
    return await _streak_dto(db, user.id, enabled)


@router.post("/streak/rewards/{milestone}/claim", response_model=StreakRewardClaimResponse)
async def claim_streak_reward(
    milestone: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        account = await streak_reward_service.claim(db, deps.get_redis(), user.id, milestone)
    except streak_reward_service.StreakRewardError as e:
        raise HTTPException(_REWARD_ERROR_STATUS[e.code], detail={"code": e.code, "message": str(e)})
    position_cache.mark_dirty()  # 보상 지급(현금·원금) → 실시간 랭킹 캐시 재적재
    return StreakRewardClaimResponse(
        streak=await _streak_dto(db, user.id, enabled=True), cash_balance=account.cash_balance,
    )

"""야간 차트 퀴즈 + 연속 출석 REST (Phase 5b)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import (
    QuizQuestionResponse, QuizSubmitRequest, QuizSubmitResponse, StreakResponse,
)
from apps.trading_game.services import feature_flag_service, quiz_service, streak_service

router = APIRouter(prefix="/api/game", tags=["trading-game-quiz"])
log = logging.getLogger("trading_game.quiz")


_ERROR_STATUS = {
    "NO_QUIZ_AVAILABLE": status.HTTP_404_NOT_FOUND,
    "QUIZ_NOT_SERVED": status.HTTP_409_CONFLICT,
    "ALREADY_SUBMITTED": status.HTTP_409_CONFLICT,
}


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
    quiz = res.quiz
    streak = None
    try:  # best-effort — 채점 결과는 항상 반환(rollback 하지 않음: quiz 속성 expire 방지)
        row = await streak_service.touch(db, deps.get_redis(), user.id)
        if row is not None:
            streak = StreakResponse(
                current_streak=row.current_streak, highest_streak=row.highest_streak,
                last_activity_date=row.last_activity_date, enabled=True,
            )
    except Exception:
        log.warning("퀴즈 Streak 갱신 실패 user=%s", user.id, exc_info=True)
    return QuizSubmitResponse(
        correct=res.correct, answer=quiz.answer, actual_change=quiz.actual_change,
        pattern_type=quiz.pattern_type, explanation=quiz.explanation,
        rewarded=res.rewarded, reward_cash=quiz.reward_cash if res.rewarded else 0,
        timed_out=res.timed_out, ticker=quiz.ticker, base_date=quiz.base_date, streak=streak,
    )


@router.get("/streak/my", response_model=StreakResponse)
async def my_streak(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    enabled = await feature_flag_service.is_enabled(db, deps.get_redis(), "STREAK")
    row = await streak_service.get_streak(db, user.id)
    if row is None:
        return StreakResponse(current_streak=0, highest_streak=0, last_activity_date=None, enabled=enabled)
    return StreakResponse(
        current_streak=row.current_streak, highest_streak=row.highest_streak,
        last_activity_date=row.last_activity_date, enabled=enabled,
    )

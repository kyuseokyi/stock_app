"""야간 차트 패턴 퀴즈 (Phase 5b) — 출제·채점·보상.

출제 시 served_at 을 기록하고 제출 시 서버가 제한시간(10초 + 여유 3초)을 판정한다.
정답 보상은 KST 하루 3회까지, 활성 시즌 계좌로 reward_service.grant_cash.
(일일 한도는 동시 제출 경합에서 드물게 1회 초과될 수 있다 — 허용.)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import ChartQuiz, UserQuizAttempt
from apps.trading_game.services import account_service, coach_service, reward_service

QUIZ_TIME_LIMIT_SECONDS = 10
QUIZ_GRACE_SECONDS = 3
DAILY_REWARD_LIMIT = 3
_SERVE_RETRIES = 3


class QuizError(Exception):
    """code: NO_QUIZ_AVAILABLE | QUIZ_NOT_SERVED | ALREADY_SUBMITTED"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class SubmitResult:
    quiz: ChartQuiz
    correct: bool
    timed_out: bool
    rewarded: bool


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # sqlite 는 naive 로 돌려줌


async def serve_random(db: AsyncSession, user_id: int, *, now: datetime | None = None) -> ChartQuiz:
    now = now or datetime.now(timezone.utc)
    attempted = select(UserQuizAttempt.quiz_id).where(UserQuizAttempt.user_id == user_id)
    for _ in range(_SERVE_RETRIES):
        quiz = (
            await db.execute(
                select(ChartQuiz).where(ChartQuiz.id.not_in(attempted)).order_by(func.random()).limit(1)
            )
        ).scalar_one_or_none()
        if quiz is None:
            break
        db.add(UserQuizAttempt(user_id=user_id, quiz_id=quiz.id, served_at=now))
        try:
            await db.commit()
            return quiz
        except IntegrityError:  # 동시 요청이 같은 문제를 먼저 배정 — 다른 문제로 재시도
            await db.rollback()
    raise QuizError("NO_QUIZ_AVAILABLE", "지금 풀 수 있는 퀴즈가 없습니다.")


async def _rewarded_count(db: AsyncSession, user_id: int, day: date) -> int:
    return await db.scalar(
        select(func.count()).select_from(UserQuizAttempt).where(
            UserQuizAttempt.user_id == user_id,
            UserQuizAttempt.rewarded.is_(True),
            UserQuizAttempt.reward_date == day,
        )
    ) or 0


async def submit(
    db: AsyncSession, user_id: int, quiz_id: int, choice: str, *, now: datetime | None = None
) -> SubmitResult:
    now = now or datetime.now(timezone.utc)
    attempt = await db.get(UserQuizAttempt, (user_id, quiz_id))
    if attempt is None:
        raise QuizError("QUIZ_NOT_SERVED", "출제되지 않은 퀴즈입니다.")
    if attempt.submitted_at is not None:
        raise QuizError("ALREADY_SUBMITTED", "이미 제출한 퀴즈입니다.")
    quiz = await db.get(ChartQuiz, quiz_id)

    elapsed = (now - _as_utc(attempt.served_at)).total_seconds()
    timed_out = elapsed > QUIZ_TIME_LIMIT_SECONDS + QUIZ_GRACE_SECONDS
    correct = (not timed_out) and choice == quiz.answer

    res = await db.execute(
        update(UserQuizAttempt)
        .where(
            UserQuizAttempt.user_id == user_id,
            UserQuizAttempt.quiz_id == quiz_id,
            UserQuizAttempt.submitted_at.is_(None),
        )
        .values(choice=choice, is_correct=correct, submitted_at=now)
    )
    if res.rowcount != 1:
        await db.rollback()
        raise QuizError("ALREADY_SUBMITTED", "이미 제출한 퀴즈입니다.")

    rewarded = False
    if correct:
        today = coach_service.kst_today(now)
        season = await account_service.get_active_season(db)
        if season is not None and await _rewarded_count(db, user_id, today) < DAILY_REWARD_LIMIT:
            await db.commit()  # 제출 기록 확정(get_or_create_account 가 commit 할 수 있음)
            account = await account_service.get_or_create_account(db, user_id, season.id)
            await reward_service.grant_cash(db, account, Decimal(quiz.reward_cash))
            await db.execute(
                update(UserQuizAttempt)
                .where(UserQuizAttempt.user_id == user_id, UserQuizAttempt.quiz_id == quiz_id)
                .values(rewarded=True, reward_date=today)
            )
            rewarded = True
    await db.commit()
    return SubmitResult(quiz=quiz, correct=correct, timed_out=timed_out, rewarded=rewarded)

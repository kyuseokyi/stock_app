"""야간 차트 패턴 퀴즈 (Phase 5b) — 출제·채점·보상.

출제 시 served_at 을 기록하고 제출 시 서버가 제한시간(10초 + 여유 3초)을 판정한다.
정답 보상은 KST 하루 3회까지, 활성 시즌 계좌로 reward_service.grant_cash.
제출은 계좌 행 잠금(SELECT ... FOR UPDATE, PG)으로 유저별 직렬화되고 제출 기록·보상·수령 표시가
한 트랜잭션으로 커밋되므로, 동시 제출에도 일일 보상 한도가 유지된다.
출제 응답은 정답 검색을 막기 위해 종목·날짜를 숨기고 가격을 정규화한다(masked_snapshot).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import ChartQuiz, GameAccount, UserQuizAttempt
from apps.trading_game.services import account_service, coach_service, reward_service

log = logging.getLogger("trading_game.quiz")

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


_PRICE_KEYS = ("open", "high", "low", "close")


def masked_snapshot(snapshot: list[dict]) -> list[dict]:
    """출제용 차트 — date 제거, 첫 캔들 종가=100 으로 가격 정규화(거래량 유지). 원본은 변경하지 않는다."""
    items = [{k: v for k, v in c.items() if k != "date"} for c in snapshot]
    if not items:
        return items
    first_close = items[0].get("close") or 0
    if not first_close:
        return items
    for c in items:
        for k in _PRICE_KEYS:
            if c.get(k) is not None:
                c[k] = round(c[k] / first_close * 100, 4)
    return items


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
    db: AsyncSession, user_id: int, quiz_id: int, choice: str, *, redis, now: datetime | None = None
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

    account: GameAccount | None = None
    if correct:
        season = await account_service.get_active_season(db)
        if season is not None and account_service.season_is_tradable(season):  # 정산 대기 시즌엔 보상 없음
            # 최초 생성 시에만 commit(계좌 행만 다룸) — 제출 기록은 아직 쓰지 않았다
            account = await account_service.get_or_create_account(db, user_id, season.id)

    if account is not None:
        # 같은 유저의 동시 제출을 계좌 행 잠금으로 직렬화 — 일일 보상 개수 집계가 일관되게 유지된다
        # (PG FOR UPDATE; SQLite 는 무시하지만 단일 writer 라 문제없음)
        await db.execute(select(GameAccount).where(GameAccount.id == account.id).with_for_update())

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
        # 0행 갱신 — 변경 없음, rollback 불필요(세션 객체 expire 방지)
        raise QuizError("ALREADY_SUBMITTED", "이미 제출한 퀴즈입니다.")

    rewarded = False
    if account is not None:
        today = coach_service.kst_today(now)
        if await _rewarded_count(db, user_id, today) < DAILY_REWARD_LIMIT:
            try:
                await reward_service.grant_cash(db, account, Decimal(quiz.reward_cash), redis=redis)
            except reward_service.RewardUnavailable:
                # 쓰기 전에 실패 — 제출 기록은 유지하고 보상만 생략
                log.warning("퀴즈 보상 생략 — 보유 포지션 시세 없음 user=%s quiz=%s", user_id, quiz_id)
            else:
                await db.execute(
                    update(UserQuizAttempt)
                    .where(UserQuizAttempt.user_id == user_id, UserQuizAttempt.quiz_id == quiz_id)
                    .values(rewarded=True, reward_date=today)
                )
                rewarded = True
    await db.commit()
    return SubmitResult(quiz=quiz, correct=correct, timed_out=timed_out, rewarded=rewarded)

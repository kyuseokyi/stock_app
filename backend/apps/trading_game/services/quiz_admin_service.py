"""차트 퀴즈 관리자 기능(백로그 ⑤-2) — 목록·상세·수정·삭제·일괄 생성·직접 출제.

생성 로직은 `scripts.generate_chart_quiz` 를 재사용한다. ClickHouse 클라이언트가 동기라
수집 단계는 `asyncio.to_thread` 로 이벤트 루프(WS 포함) 밖에서 돈다. fetch 함수는
호출 시점에 모듈 속성으로 조회한다(기본 인자 바인딩을 피해 테스트 monkeypatch 가 먹도록).
"""
from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import ChartQuiz, UserQuizAttempt
from scripts import generate_chart_quiz as gen


# 직접 출제 조회 범위 — 기준일 이전 60거래일(휴장 포함 ≈ 90일)·이후 5거래일(연휴 포함)을 넉넉히 덮는다
DIRECT_LOOKBACK_DAYS = 150
DIRECT_LOOKAHEAD_DAYS = 20

_REASON_MESSAGES = {
    "INSUFFICIENT_DATA": "기준일 일봉이 없거나 기준일까지 60거래일·이후 5거래일 데이터가 부족합니다.",
    "INVALID_SERIES": "종가 0 이하 또는 하루 30% 초과 변동(미반영 분할 등)이 있어 출제할 수 없습니다.",
    "TOO_FLAT": "이후 5거래일 등락률이 1% 미만이라 정답이 애매합니다.",
}


class QuizAdminError(Exception):
    """code: NOT_FOUND | HAS_ATTEMPTS | DUPLICATE | INSUFFICIENT_DATA | TOO_FLAT | INVALID_SERIES"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class QuizWithAttempts:
    quiz: ChartQuiz
    attempt_count: int


def _attempts_subquery():
    return (
        select(UserQuizAttempt.quiz_id, func.count().label("cnt"))
        .group_by(UserQuizAttempt.quiz_id)
        .subquery()
    )


async def list_quizzes(
    db: AsyncSession, *, page: int, size: int, active: bool | None
) -> tuple[list[QuizWithAttempts], int]:
    """최신순(created_at desc, id desc) 페이지 + 전체 건수."""
    cond = [] if active is None else [ChartQuiz.is_active.is_(active)]
    total = await db.scalar(select(func.count(ChartQuiz.id)).where(*cond)) or 0
    att = _attempts_subquery()
    rows = await db.execute(
        select(ChartQuiz, func.coalesce(att.c.cnt, 0))
        .outerjoin(att, att.c.quiz_id == ChartQuiz.id)
        .where(*cond)
        .order_by(ChartQuiz.created_at.desc(), ChartQuiz.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    return [QuizWithAttempts(q, int(cnt)) for q, cnt in rows.all()], int(total)


async def _attempt_count(db: AsyncSession, quiz_id: int) -> int:
    return int(
        await db.scalar(select(func.count()).select_from(UserQuizAttempt).where(UserQuizAttempt.quiz_id == quiz_id))
        or 0
    )


async def _get_or_404(db: AsyncSession, quiz_id: int) -> ChartQuiz:
    quiz = await db.get(ChartQuiz, quiz_id)
    if quiz is None:
        raise QuizAdminError("NOT_FOUND", "퀴즈를 찾을 수 없습니다.")
    return quiz


async def get_quiz(db: AsyncSession, quiz_id: int) -> QuizWithAttempts:
    quiz = await _get_or_404(db, quiz_id)
    return QuizWithAttempts(quiz, await _attempt_count(db, quiz_id))


async def update_quiz(db: AsyncSession, quiz_id: int, fields: dict) -> QuizWithAttempts:
    """pattern_type·explanation·is_active 만(DTO 가 그 외 필드를 막는다). None 은 미변경."""
    quiz = await _get_or_404(db, quiz_id)
    for key, value in fields.items():
        if value is not None:
            setattr(quiz, key, value)
    await db.commit()
    await db.refresh(quiz)
    return QuizWithAttempts(quiz, await _attempt_count(db, quiz_id))


async def delete_quiz(db: AsyncSession, quiz_id: int) -> None:
    """시도 기록이 있으면 HAS_ATTEMPTS(FK CASCADE 로 기록이 지워지지 않도록 선검사)."""
    quiz = await _get_or_404(db, quiz_id)
    if await _attempt_count(db, quiz_id) > 0:
        raise QuizAdminError("HAS_ATTEMPTS", "시도 기록이 있는 퀴즈는 삭제할 수 없습니다. 비활성으로 전환하세요.")
    await db.delete(quiz)
    await db.commit()


async def generate_quizzes(db: AsyncSession, count: int, *, rng: random.Random | None = None) -> tuple[int, int]:
    """기존 생성기 규칙으로 count 개 시도 → (created, skipped_duplicate)."""
    quizzes = await asyncio.to_thread(
        gen.collect_quizzes, count, rng=rng or random.Random(),
        fetch_tickers=gen._fetch_tickers, fetch_candles=gen._fetch_candles,
    )
    return await gen.insert_quizzes(db, quizzes)


async def _exists(db: AsyncSession, ticker: str, base_date: date) -> bool:
    found = await db.scalar(
        select(ChartQuiz.id).where(ChartQuiz.ticker == ticker, ChartQuiz.base_date == base_date)
    )
    return found is not None


async def create_quiz(db: AsyncSession, ticker: str, base_date: date) -> QuizWithAttempts:
    """종목·기준일 직접 출제. 정답·등락률·해설은 생성기 규칙(evaluate_quiz)으로 자동 계산."""
    duplicate = QuizAdminError("DUPLICATE", "같은 종목·기준일 퀴즈가 이미 있습니다.")
    if await _exists(db, ticker, base_date):
        raise duplicate
    candles = await asyncio.to_thread(
        gen._fetch_candles, ticker,
        base_date - timedelta(days=DIRECT_LOOKBACK_DAYS), base_date + timedelta(days=DIRECT_LOOKAHEAD_DAYS),
    )
    base_iso = base_date.isoformat()
    base_idx = next((i for i, c in enumerate(candles) if str(c["date"])[:10] == base_iso), None)
    result = "INSUFFICIENT_DATA" if base_idx is None else gen.evaluate_quiz(ticker, candles, base_idx)
    if isinstance(result, str):
        raise QuizAdminError(result, _REASON_MESSAGES[result])
    quiz = ChartQuiz(**result)
    db.add(quiz)
    try:
        await db.commit()
    except IntegrityError:  # 동시 생성(beat·다른 관리자)이 먼저 삽입
        await db.rollback()
        raise duplicate
    await db.refresh(quiz)
    return QuizWithAttempts(quiz, 0)

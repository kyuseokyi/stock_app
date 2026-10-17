"""차트 퀴즈 풀 정기 보충 Celery 태스크(매일 21:00 — 일봉 수집 20:30·정산 20:40 이후).

아직 어떤 사용자도 시도하지 않은 문제 수가 QUIZ_POOL_MIN_UNSEEN(기본 100) 미만일 때만
QUIZ_POOL_BATCH(기본 200)개를 생성한다. 이 '미시도 재고'는 어느 사용자의 남은 문제 수보다도 작거나 같으므로
(남은 문제 = 미시도 + 남이 본 것 중 내가 안 본 것) 가장 많이 푼 사용자보다 먼저 보충이 걸린다.
생성 로직은 `scripts.generate_chart_quiz.generate` 를 그대로 재사용한다
(수동 CLI `uv run python -m scripts.generate_chart_quiz` 도 유지).
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
from typing import Awaitable, Callable

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import AsyncSessionLocal, engine
from shared.game_models import ChartQuiz, UserQuizAttempt
from apps.collector.celery_app import celery_app
from scripts import generate_chart_quiz as gen

log = logging.getLogger("collector.quiz_task")

DEFAULT_MIN_UNSEEN = 100
DEFAULT_BATCH = 200  # 자동 생성 품질 기준(신호·3%·간격)이 엄격해져도 하룻밤에 넉넉히 채우도록

GenerateFn = Callable[..., Awaitable[tuple[int, int]]]


def _positive_int_env(key: str, default: int) -> int:
    raw = (os.getenv(key) or "").strip()
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def pool_settings() -> tuple[int, int]:
    """(min_unseen, batch) — 실행 시점 env 기준. 비었거나 잘못된 값은 기본값."""
    return (
        _positive_int_env("QUIZ_POOL_MIN_UNSEEN", DEFAULT_MIN_UNSEEN),
        _positive_int_env("QUIZ_POOL_BATCH", DEFAULT_BATCH),
    )


async def count_unseen(db: AsyncSession) -> int:
    """chart_quiz_pool 중 활성이고 user_quiz_attempts 에 한 번도 등장하지 않은 문제 수(비활성은 재고 아님)."""
    attempted = exists().where(UserQuizAttempt.quiz_id == ChartQuiz.id)
    stmt = select(func.count(ChartQuiz.id)).where(ChartQuiz.is_active.is_(True), ~attempted)
    return int((await db.execute(stmt)).scalar_one())


async def refill_quiz_pool(
    session_factory,
    *,
    generate_fn: GenerateFn,
    min_unseen: int,
    batch: int,
) -> dict:
    async with session_factory() as db:
        unseen = await count_unseen(db)
    if unseen >= min_unseen:
        log.info("퀴즈 재고 충분 — skip (unseen=%d, min=%d)", unseen, min_unseen)
        return {"generated": 0, "skipped_reason": f"unseen={unseen} >= min={min_unseen}"}
    created, duplicated = await generate_fn(batch, rng=random.Random(), session_factory=session_factory)
    log.info("퀴즈 보충 — unseen=%d, batch=%d, created=%d, duplicate=%d", unseen, batch, created, duplicated)
    return {"generated": created, "skipped_reason": None}


async def _run() -> dict:
    min_unseen, batch = pool_settings()
    try:
        return await refill_quiz_pool(
            AsyncSessionLocal, generate_fn=gen.generate, min_unseen=min_unseen, batch=batch
        )
    finally:
        await engine.dispose()  # asyncio.run 마다 새 루프 — 이전 루프에 묶인 커넥션 풀 정리


@celery_app.task(name="collector.generate_chart_quiz")
def generate_chart_quiz() -> dict:
    result = asyncio.run(_run())
    log.info("퀴즈 정기 생성 결과: %s", result)
    return result

"""차트 퀴즈 풀 정기 보충 — Celery 태스크·beat 스케줄 테스트(sqlite + 목, 실 CH·DB 미사용)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import ChartQuiz, UserQuizAttempt
from apps.collector.celery_app import celery_app
from apps.collector.tasks import quiz as quiz_task


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _seed_quizzes(maker, n: int, *, attempted: int = 0) -> None:
    async with maker() as db:
        user = User(email="q@test.local", nickname="퀴즈러", role=UserRole.FREE, is_active=True)
        db.add(user)
        quizzes = [
            ChartQuiz(
                ticker=f"{i:06d}", base_date=date(2026, 1, 1), pattern_type="정배열",
                chart_snapshot=[], answer="UP", actual_change=Decimal("1.50"), explanation="-",
            )
            for i in range(n)
        ]
        db.add_all(quizzes)
        await db.flush()
        for q in quizzes[:attempted]:
            db.add(UserQuizAttempt(user_id=user.id, quiz_id=q.id, served_at=datetime.now(timezone.utc)))
        await db.commit()


async def test_count_unseen_excludes_attempted(maker):
    await _seed_quizzes(maker, 3, attempted=1)
    async with maker() as db:
        assert await quiz_task.count_unseen(db) == 2


async def test_refill_skips_when_stock_enough(maker):
    await _seed_quizzes(maker, 3, attempted=1)  # 미시도 2 == min
    gen = AsyncMock(return_value=(5, 0))
    result = await quiz_task.refill_quiz_pool(maker, generate_fn=gen, min_unseen=2, batch=5)
    assert result["generated"] == 0
    assert isinstance(result["skipped_reason"], str) and result["skipped_reason"]
    gen.assert_not_awaited()


async def test_refill_generates_when_stock_low(maker):
    await _seed_quizzes(maker, 3, attempted=2)  # 미시도 1 < min 2
    gen = AsyncMock(return_value=(4, 1))
    result = await quiz_task.refill_quiz_pool(maker, generate_fn=gen, min_unseen=2, batch=5)
    assert result == {"generated": 4, "skipped_reason": None}
    gen.assert_awaited_once()
    args, kwargs = gen.await_args
    assert args == (5,)
    assert kwargs["session_factory"] is maker
    assert "rng" in kwargs


async def test_refill_when_legacy_stock_low(maker):
    """전체 미시도 재고가 넉넉해도 구버전 앱용(DIRECTION·5일) 재고가 모자라면 보충한다."""
    async with maker() as db:
        for i in range(4):
            db.add(ChartQuiz(
                ticker=f"9{i:05d}", base_date=date(2026, 1, 1), pattern_type="정배열", chart_snapshot=[],
                answer="R_UP", actual_change=Decimal("3.50"), explanation="-", quiz_type="RANGE",
            ))
        db.add(ChartQuiz(
            ticker="800000", base_date=date(2026, 1, 1), pattern_type="정배열", chart_snapshot=[],
            answer="UP", actual_change=Decimal("3.50"), explanation="-", horizon_bars=10,
        ))
        await db.commit()
        assert await quiz_task.count_unseen(db) == 5
        assert await quiz_task.count_unseen(db, legacy_only=True) == 0
    gen = AsyncMock(return_value=(3, 0))
    result = await quiz_task.refill_quiz_pool(maker, generate_fn=gen, min_unseen=2, batch=5)
    assert result == {"generated": 3, "skipped_reason": None}


async def test_refill_generates_when_pool_empty(maker):
    gen = AsyncMock(return_value=(0, 0))
    result = await quiz_task.refill_quiz_pool(maker, generate_fn=gen, min_unseen=100, batch=50)
    assert result == {"generated": 0, "skipped_reason": None}
    gen.assert_awaited_once()


@pytest.mark.parametrize(
    ("min_raw", "batch_raw", "expected"),
    [
        (None, None, (100, 200)),
        ("30", "10", (30, 10)),
        ("abc", "", (100, 200)),
        ("-1", "0", (100, 200)),
    ],
)
def test_pool_settings_from_env(monkeypatch, min_raw, batch_raw, expected):
    for key, raw in (("QUIZ_POOL_MIN_UNSEEN", min_raw), ("QUIZ_POOL_BATCH", batch_raw)):
        if raw is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, raw)
    assert quiz_task.pool_settings() == expected


def test_default_generate_fn_is_script_generate():
    """생성 로직은 스크립트 것을 재사용한다(복제 금지)."""
    from scripts import generate_chart_quiz as gen

    assert quiz_task.gen is gen


def test_beat_schedule_and_registration():
    entry = celery_app.conf.beat_schedule["generate-chart-quiz"]
    assert entry["task"] == "collector.generate_chart_quiz"
    assert entry["schedule"].hour == {21}
    assert entry["schedule"].minute == {0}
    assert "apps.collector.tasks.quiz" in celery_app.conf.include
    assert "collector.generate_chart_quiz" in celery_app.tasks


def test_task_wrapper_returns_result(monkeypatch):
    expected = {"generated": 3, "skipped_reason": None}
    monkeypatch.setattr(quiz_task, "_run", AsyncMock(return_value=expected))
    assert quiz_task.generate_chart_quiz() == expected

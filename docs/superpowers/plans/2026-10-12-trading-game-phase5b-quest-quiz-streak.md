# 트레이딩 게임 Phase 5b — 퀘스트·아카데미·야간 퀴즈·Streak 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 퀘스트(Q1·Q2·Q3')·아카데미 5배 레버리지 해금·야간 차트 퀴즈·연속 출석(Streak)·어드민 기능 on/off를 trading_game(8003)과 admin_web에 추가한다.

**Architecture:** Router → Service → ORM. 보상은 `reward_service.grant_cash` 하나로 지급하며 펀드 입금 방식으로 원금 조정분(`bonus_cash`)을 늘려 실현 ROI를 불변으로 유지한다. 퀘스트·Streak 갱신은 주문 직후 best-effort 훅(실패해도 주문 성공), 5배 잠금만 필수 게이트. 기능 플래그는 DB 원장 + Redis 30초 캐시.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest(asyncio_mode=auto, aiosqlite, fakeredis, httpx ASGITransport), ClickHouse(종가), React+Vite+TS(strict)+Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-12-trading-game-phase5b-quest-quiz-streak-design.md`

---

## 공통 규칙 (모든 태스크)

- 작업 디렉토리: 레포 루트 `stock_app/`. 백엔드 명령은 `cd backend && uv run ...`.
- pytest 요약 줄이 숨겨져 있다. 결과는 점(`.`)·`F`·`E` 개수로 판단하거나 `-v`를 쓴다. 전체 실행: `cd backend && uv run pytest -q 2>&1 | tail -5`.
- **절대 `git add -A` / `git add .` 금지.** 태스크에 적힌 경로만 stage. `.claude/`, `.serena/project.yml`은 커밋하지 않는다.
- 커밋은 `dev` 브랜치. 커밋 메시지 끝에 정확히 다음 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- `backend/.env.development`의 KIS 키를 출력·커밋하지 않는다. dev 터널 DB(15432)는 건드리지 않는다.
- 신규 유저 API의 에러 `detail`은 `{"code": "...", "message": "..."}` 객체로 통일한다(관리자 API는 5a처럼 문자열).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/shared/game_models.py` (수정) | `GameAccount.bonus_cash` + 신규 ORM 7개 |
| `backend/alembic/versions/d4e5f6a7b8c9_phase5b_quest_quiz_streak.py` (생성) | 스키마 + 플래그 시드 |
| `backend/apps/trading_game/services/reward_service.py` (생성) | `principal`, `principal_increment`, `grant_cash` |
| `backend/apps/trading_game/services/order_engine.py` (수정) | 청산 ROI 분모 = 원금 |
| `backend/apps/trading_game/services/tick_listener.py` (수정) | 실시간 ROI 분모 = 원금 |
| `backend/apps/trading_game/services/feature_flag_service.py` (생성) | 플래그 조회(캐시)·변경 |
| `backend/apps/trading_game/services/streak_service.py` (생성) | Streak 규칙·갱신 |
| `backend/apps/trading_game/services/indicators.py` (생성) | 순수 함수 `golden_cross_within` |
| `backend/apps/trading_game/services/rsi_service.py` (수정) | `cached_closes` 추출(종가 캐시 재사용) |
| `backend/apps/trading_game/services/quest_service.py` (생성) | 퀘스트 정의·진행·수령 |
| `backend/apps/trading_game/services/academy_service.py` (생성) | 3문항·채점·해금 |
| `backend/apps/trading_game/services/quiz_service.py` (생성) | 출제·채점·보상 한도 |
| `backend/apps/trading_game/schemas/game_dtos.py` (수정) | 5b DTO |
| `backend/apps/trading_game/routers/feature_flags.py`·`quests.py`·`academy.py`·`quiz.py` (생성) | REST |
| `backend/apps/trading_game/routers/orders.py` (수정) | 5배 잠금 + 훅 |
| `backend/apps/trading_game/main.py` (수정) | 라우터 등록 |
| `backend/scripts/generate_chart_quiz.py` (생성) | 퀴즈 자동 생성 |
| `backend/tests/test_quest_quiz_streak.py` (생성) | 5b 테스트 전부 |
| `backend/tests/test_coach_and_nudge.py` (수정) | 5배 주문 테스트 2건 해금 시드 |
| `admin_web/src/types/game.ts`·`api/coach.ts`(수정), `api/featureFlags.ts`·`pages/TradingGameSettings.tsx`(생성), `components/Sidebar.tsx`·`App.tsx`(수정) | 기능 설정 화면 |
| `README.md`, `docs/ROADMAP.md` (수정) | 문서 |

---

### Task 1: ORM 모델 + Alembic 마이그레이션

**Files:**
- Modify: `backend/shared/game_models.py`
- Create: `backend/alembic/versions/d4e5f6a7b8c9_phase5b_quest_quiz_streak.py`
- Create: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 테스트 파일 생성(공용 픽스처 + 모델 테스트)**

`backend/tests/test_quest_quiz_streak.py`:

```python
"""트레이딩 게임 Phase 5b — 퀘스트·아카데미·야간 퀴즈·Streak·기능 플래그 테스트."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole
from shared.game_models import (
    ChartQuiz, GameAccount, GameFeatureFlag, GameSeason, UserAcademy, UserBadge,
    UserQuestProgress, UserQuizAttempt, UserStreak,
)
from apps.trading_game import deps
from apps.trading_game.main import app


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


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


@pytest.fixture
def fake_redis(monkeypatch):
    """deps.get_redis 를 fakeredis 로 교체(라우터·서비스 공용)."""
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(deps, "get_redis", lambda: redis)
    return redis


@pytest.fixture
async def api(maker):
    """(client, set_user) — get_db 는 테스트 엔진, 인증 유저는 set_user 로 교체."""
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, (lambda u: state.__setitem__("user", u))
    app.dependency_overrides.clear()


async def _seed_season(db, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def _seed_user(db, *, role: UserRole = UserRole.FREE, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=role, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _seed_account(db, user, season, *, cash=Decimal("10000000"), roi=Decimal("0")) -> GameAccount:
    acc = GameAccount(
        user_id=user.id, season_id=season.id, cash_balance=cash, total_asset=cash, current_roi=roi,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc


# ---------------------------------------------------------------- models
async def test_phase5b_tables_roundtrip(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    session.add(acc)
    quiz = ChartQuiz(
        ticker="005930", base_date=date(2026, 9, 1), pattern_type="골든크로스",
        chart_snapshot=[{"date": "2026-09-01", "open": 1.0, "high": 2.0, "low": 1.0, "close": 2.0, "volume": 10}],
        answer="UP", actual_change=Decimal("3.25"), explanation="해설",
    )
    session.add_all([
        quiz,
        UserQuestProgress(user_id=user.id, quest_code="Q1_STOP_LOSS"),
        UserBadge(user_id=user.id, badge_code="PRINCIPLED"),
        UserAcademy(user_id=user.id),
        UserStreak(user_id=user.id),
        GameFeatureFlag(key="QUIZ", enabled=True),
    ])
    await session.commit()
    session.add(UserQuizAttempt(user_id=user.id, quiz_id=quiz.id, served_at=datetime.now(timezone.utc)))
    await session.commit()

    await session.refresh(acc)
    assert acc.bonus_cash == Decimal("0")
    assert quiz.reward_cash == 200000
    ua = await session.get(UserAcademy, user.id)
    assert ua.unlocked_leverage_5x is False and ua.attempts == 0 and ua.passed_at is None
    st = await session.get(UserStreak, user.id)
    assert st.current_streak == 0 and st.highest_streak == 0 and st.last_activity_date is None
    qp = await session.get(UserQuestProgress, (user.id, "Q1_STOP_LOSS"))
    assert qp.progress == 0 and qp.completed_at is None and qp.claimed_at is None
    att = await session.get(UserQuizAttempt, (user.id, quiz.id))
    assert att.rewarded is False and att.reward_date is None and att.submitted_at is None


async def test_quiz_unique_ticker_base_date(session):
    for _ in range(2):
        session.add(ChartQuiz(
            ticker="005930", base_date=date(2026, 9, 1), pattern_type="정배열",
            chart_snapshot=[], answer="UP", actual_change=Decimal("2"), explanation="x",
        ))
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v 2>&1 | tail -5`
Expected: ImportError (`ChartQuiz` 등 없음)

- [ ] **Step 3: ORM 추가**

`backend/shared/game_models.py`:
1) 모듈 docstring의 `교육·소셜 테이블(chart_quiz_pool, user_streaks, private_leagues)은 추후 Phase.` → `Phase 5b: 퀘스트·배지·아카데미·차트 퀴즈·Streak·기능 플래그. private_leagues 는 추후 Phase.`
2) `from sqlalchemy import (` 목록에 `JSON,` 추가(`Integer,` 다음).
3) `GameAccount`의 `win_trades` 줄 바로 아래에 추가:

```python
    # Phase 5b: 보상 지급 시 늘어나는 원금 조정분(펀드 입금 방식). 원금 = INITIAL_CASH + bonus_cash.
    bonus_cash: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
```

4) 파일 끝에 추가:

```python
# ---------------------------------------------------------------- Phase 5b: 교육·습관 테이블


class UserQuestProgress(Base):
    """유저별 퀘스트 진행(영구 1회성). 퀘스트 정의는 코드 상수(quest_service.QUESTS)."""

    __tablename__ = "user_quest_progress"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    quest_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserBadge(Base):
    """보유 배지(퀘스트 보상)."""

    __tablename__ = "user_badges"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    badge_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    awarded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UserAcademy(Base):
    """아카데미 수료 상태 — 5배 레버리지 해금 플래그."""

    __tablename__ = "user_academy"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    unlocked_leverage_5x: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ChartQuiz(Base):
    """야간 차트 패턴 퀴즈 풀(자동 생성). (ticker, base_date) 유일."""

    __tablename__ = "chart_quiz_pool"
    __table_args__ = (UniqueConstraint("ticker", "base_date", name="uq_quiz_ticker_base_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    base_date: Mapped[date] = mapped_column(Date, nullable=False)
    pattern_type: Mapped[str] = mapped_column(String(50), nullable=False)
    chart_snapshot: Mapped[list] = mapped_column(JSON, nullable=False)  # OHLCV dict 배열(기준일까지)
    answer: Mapped[str] = mapped_column(String(10), nullable=False)  # 'UP' / 'DOWN'
    actual_change: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    reward_cash: Mapped[int] = mapped_column(
        Integer, nullable=False, default=200000, server_default="200000"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UserQuizAttempt(Base):
    """퀴즈 출제·제출 기록. served_at 으로 서버가 제한시간을 판정한다."""

    __tablename__ = "user_quiz_attempts"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    quiz_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chart_quiz_pool.id", ondelete="CASCADE"), primary_key=True
    )
    served_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    choice: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    rewarded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    reward_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # 보상 지급 KST 날짜(일일 한도)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserStreak(Base):
    """연속 출석(KST 날짜 기준)."""

    __tablename__ = "user_streaks"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    highest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class GameFeatureFlag(Base):
    """기능 on/off(QUIZ, STREAK). 행이 없으면 서비스가 ON 으로 간주."""

    __tablename__ = "game_feature_flags"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
```

- [ ] **Step 4: 마이그레이션 생성**

`backend/alembic/versions/d4e5f6a7b8c9_phase5b_quest_quiz_streak.py`:

```python
"""Phase 5b: bonus_cash + quest/badge/academy/quiz/streak/feature-flag tables

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def _user_fk() -> sa.Column:
    return sa.Column(
        "user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


def upgrade() -> None:
    op.add_column(
        "game_accounts",
        sa.Column("bonus_cash", sa.Numeric(15, 2), nullable=False, server_default="0"),
    )
    op.create_table(
        "user_quest_progress",
        _user_fk(),
        sa.Column("quest_code", sa.String(30), primary_key=True),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "user_badges",
        _user_fk(),
        sa.Column("badge_code", sa.String(30), primary_key=True),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "user_academy",
        _user_fk(),
        sa.Column("unlocked_leverage_5x", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "chart_quiz_pool",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("base_date", sa.Date, nullable=False),
        sa.Column("pattern_type", sa.String(50), nullable=False),
        sa.Column("chart_snapshot", sa.JSON, nullable=False),
        sa.Column("answer", sa.String(10), nullable=False),
        sa.Column("actual_change", sa.Numeric(6, 2), nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("reward_cash", sa.Integer, nullable=False, server_default="200000"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("ticker", "base_date", name="uq_quiz_ticker_base_date"),
    )
    op.create_table(
        "user_quiz_attempts",
        _user_fk(),
        sa.Column(
            "quiz_id", sa.Integer, sa.ForeignKey("chart_quiz_pool.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("served_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("choice", sa.String(10), nullable=True),
        sa.Column("is_correct", sa.Boolean, nullable=True),
        sa.Column("rewarded", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("reward_date", sa.Date, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "user_streaks",
        _user_fk(),
        sa.Column("current_streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("highest_streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_activity_date", sa.Date, nullable=True),
    )
    flags = op.create_table(
        "game_feature_flags",
        sa.Column("key", sa.String(30), primary_key=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )
    op.bulk_insert(flags, [{"key": "QUIZ", "enabled": True}, {"key": "STREAK", "enabled": True}])


def downgrade() -> None:
    op.drop_table("game_feature_flags")
    op.drop_table("user_streaks")
    op.drop_table("user_quiz_attempts")
    op.drop_table("chart_quiz_pool")
    op.drop_table("user_academy")
    op.drop_table("user_badges")
    op.drop_table("user_quest_progress")
    op.drop_column("game_accounts", "bonus_cash")
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v 2>&1 | tail -5` → 2 passed
Run: `cd backend && uv run pytest -q 2>&1 | tail -5` → F/E 없음

- [ ] **Step 6: 일회용 PG에서 마이그레이션 검증** (dev 터널 DB 금지)

```bash
docker exec stock_postgres createdb -U postgres stock_p5b_mig
cd backend
export ALEMBIC_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/stock_p5b_mig
uv run alembic upgrade head
uv run alembic check
uv run alembic downgrade c3d4e5f6a7b8
uv run alembic upgrade head
docker exec stock_postgres psql -U postgres -d stock_p5b_mig -c "select key, enabled from game_feature_flags order by key"
docker exec stock_postgres dropdb -U postgres stock_p5b_mig
```
Expected: `alembic check` → "No new upgrade operations detected.", 플래그 2행(QUIZ/STREAK true).
PG 사용자·비밀번호·드라이버가 다르면 `docker exec stock_postgres env | grep POSTGRES`와 `backend/alembic/env.py`를 보고 URL만 맞춘다(5a 마이그레이션 검증과 같은 절차).

- [ ] **Step 7: 커밋**

```bash
git add backend/shared/game_models.py backend/alembic/versions/d4e5f6a7b8c9_phase5b_quest_quiz_streak.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): Phase5b 스키마 — bonus_cash·퀘스트·배지·아카데미·차트퀴즈·Streak·기능플래그

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 보상 서비스 + ROI 분모를 원금으로

**Files:**
- Create: `backend/apps/trading_game/services/reward_service.py`
- Modify: `backend/apps/trading_game/services/order_engine.py` (`close_position`의 `roi_acc`, import)
- Modify: `backend/apps/trading_game/services/tick_listener.py` (`compute_live_roi` 호출, import)
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가** (파일 끝에)

```python
# ---------------------------------------------------------------- reward / principal
from apps.trading_game.services import order_engine, reward_service, tick_listener


def _realized_roi(acc: GameAccount) -> Decimal:
    base = reward_service.principal(acc)
    return ((acc.cash_balance - base) / base * Decimal("100")).quantize(Decimal("0.0001"))


@pytest.mark.parametrize("cash, roi", [
    (Decimal("10500000"), Decimal("5")),
    (Decimal("8000000"), Decimal("-20")),
    (Decimal("10000000"), Decimal("0")),
])
async def test_grant_cash_keeps_realized_roi(session, cash, roi):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = await _seed_account(session, user, season, cash=cash, roi=roi)
    assert _realized_roi(acc) == roi

    await reward_service.grant_cash(session, acc, Decimal("500000"))
    await session.commit()
    await session.refresh(acc)

    assert acc.cash_balance == cash + Decimal("500000")
    assert acc.total_asset == cash + Decimal("500000")
    assert acc.current_roi == roi  # 저장 ROI 는 건드리지 않음
    assert abs(_realized_roi(acc) - roi) <= Decimal("0.0001")


def test_principal_increment_formula_and_floor():
    assert reward_service.principal_increment(Decimal("500000"), Decimal("-20")) == Decimal("625000.00")
    assert reward_service.principal_increment(Decimal("500000"), Decimal("0")) == Decimal("500000.00")
    # ROI -100%(자산 0) → 1+r 하한 0.01
    assert reward_service.principal_increment(Decimal("100"), Decimal("-100")) == Decimal("10000.00")


async def test_close_position_roi_uses_principal(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = await _seed_account(session, user, season, cash=Decimal("11000000"))
    acc.bonus_cash = Decimal("1000000")  # 원금 11,000,000
    await session.commit()

    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.25"), leverage=1,
        entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("100"), reason="MANUAL")
    await session.refresh(acc)
    base = Decimal("11000000")
    expected = ((acc.cash_balance - base) / base * Decimal("100")).quantize(Decimal("0.0001"))
    assert acc.current_roi == expected
    assert acc.current_roi < 0  # 수수료만큼 손실(INITIAL_CASH 기준이었다면 약 +10%)


async def test_live_rank_roi_uses_principal(maker, monkeypatch):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(tick_listener, "AsyncSessionLocal", maker)
    monkeypatch.setattr(tick_listener.deps, "get_redis", lambda: redis)
    async with maker() as db:
        user = await _seed_user(db)
        season = await _seed_season(db)
        acc = await _seed_account(db, user, season, cash=Decimal("11000000"))
        acc.bonus_cash = Decimal("1000000")
        await db.commit()
        await order_engine.open_position(
            db, account=acc, side="LONG", ratio=Decimal("0.25"), leverage=1,
            entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )
    await tick_listener._push_personal_pnl("005930", Decimal("100"))
    score = await redis.zscore(f"game:season:{season.id}:ranking", str(user.id))
    assert score is not None and -1 < score < 0  # 원금 11M 기준(수수료만큼 소폭 음수)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k "grant_cash or principal or close_position_roi or live_rank" 2>&1 | tail -8`
Expected: ImportError(`reward_service`) → FAIL

- [ ] **Step 3: reward_service 작성**

`backend/apps/trading_game/services/reward_service.py`:

```python
"""보상 지급 — 원금 동반 가산(펀드 입금 방식) (Phase 5b).

실현 자산 A = P(1+r) 일 때 원금을 P' = P + b/(1+r) 로 늘리면 (A+b)/P' = 1+r → ROI 불변.
같은 금액 b 를 원금에 그대로 더하면 (A-P)/(P+b) 로 ROI 가 0 쪽으로 희석되어
마이너스 계좌가 보상만으로 순위가 오르는 문제가 생긴다.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import INITIAL_CASH, GameAccount

_CENT = Decimal("0.01")
_MIN_GROWTH = Decimal("0.01")  # ROI -100%(자산 0) 방어


def principal(acc: GameAccount) -> Decimal:
    """ROI 분모 = 초기자본 + 보상 원금 조정분."""
    return INITIAL_CASH + (acc.bonus_cash or Decimal("0"))


def principal_increment(amount: Decimal, current_roi_pct: Decimal) -> Decimal:
    growth = max(Decimal("1") + current_roi_pct / Decimal("100"), _MIN_GROWTH)
    return (amount / growth).quantize(_CENT, rounding=ROUND_HALF_UP)


async def grant_cash(db: AsyncSession, account: GameAccount, amount: Decimal) -> None:
    """현금·총자산 +amount, 원금 조정분 +amount/(1+r). commit 은 호출부 책임(수령 기록과 한 트랜잭션)."""
    inc = principal_increment(amount, account.current_roi)
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == account.id)
        .values(
            cash_balance=GameAccount.cash_balance + amount,
            total_asset=GameAccount.total_asset + amount,
            bonus_cash=GameAccount.bonus_cash + inc,
        )
    )
```

- [ ] **Step 4: order_engine 수정**

`backend/apps/trading_game/services/order_engine.py`:
- `from shared.game_models import INITIAL_CASH, GameAccount, GamePosition, GameTrade` → `from shared.game_models import GameAccount, GamePosition, GameTrade`
- `from apps.trading_game.services import pricing` → `from apps.trading_game.services import pricing, reward_service`
- `close_position`의

```python
    roi_acc = ((acc.cash_balance - INITIAL_CASH) / INITIAL_CASH * Decimal("100")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
```
를 다음으로 교체:

```python
    base = reward_service.principal(acc)  # Phase 5b: 보상 원금 조정분 포함
    roi_acc = ((acc.cash_balance - base) / base * Decimal("100")).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP
    )
```

- [ ] **Step 5: tick_listener 수정**

`backend/apps/trading_game/services/tick_listener.py`:
- `from shared.game_models import INITIAL_CASH, GameAccount, GamePosition, GameSeason` → `from shared.game_models import GameAccount, GamePosition, GameSeason`
- `account_service, liquidation_service, nudge_engine, pricing, ranking_service,` → `account_service, liquidation_service, nudge_engine, pricing, ranking_service, reward_service,`
- `live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, INITIAL_CASH)` → `live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, reward_service.principal(acc))`

그 후 `grep -n INITIAL_CASH backend/apps/trading_game/services/tick_listener.py backend/apps/trading_game/services/order_engine.py` 결과가 없어야 한다.

- [ ] **Step 6: 테스트 통과 + 회귀**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v 2>&1 | tail -10` → 전부 PASS
Run: `cd backend && uv run pytest -q 2>&1 | tail -5` → F/E 없음

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/services/reward_service.py backend/apps/trading_game/services/order_engine.py backend/apps/trading_game/services/tick_listener.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 보상 지급 서비스(펀드 입금 방식) + 청산·실시간 ROI 분모를 원금으로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 기능 플래그 서비스 + 어드민 API

**Files:**
- Create: `backend/apps/trading_game/services/feature_flag_service.py`
- Create: `backend/apps/trading_game/routers/feature_flags.py`
- Modify: `backend/apps/trading_game/schemas/game_dtos.py` (끝에 DTO 추가)
- Modify: `backend/apps/trading_game/main.py` (라우터 등록)
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- feature flags
from apps.trading_game.services import feature_flag_service


class _BrokenRedis:
    async def get(self, *a, **k):
        raise ConnectionError("redis down")

    async def set(self, *a, **k):
        raise ConnectionError("redis down")

    async def delete(self, *a, **k):
        raise ConnectionError("redis down")


async def test_flag_default_on_cache_and_invalidate(session):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    assert await feature_flag_service.is_enabled(session, redis, "QUIZ") is True  # 행 없음 → ON
    assert await redis.get("game:flag:QUIZ") == "1"
    await feature_flag_service.set_flag(session, redis, "QUIZ", False)
    assert await redis.get("game:flag:QUIZ") is None  # 변경 즉시 캐시 삭제
    assert await feature_flag_service.is_enabled(session, redis, "QUIZ") is False
    assert await redis.get("game:flag:QUIZ") == "0"


async def test_flag_redis_error_falls_back_to_db(session):
    session.add(GameFeatureFlag(key="STREAK", enabled=False))
    await session.commit()
    assert await feature_flag_service.is_enabled(session, _BrokenRedis(), "STREAK") is False
    row = await feature_flag_service.set_flag(session, _BrokenRedis(), "STREAK", True)
    assert row.enabled is True


async def test_flag_unknown_key(session):
    with pytest.raises(feature_flag_service.UnknownFlag):
        await feature_flag_service.set_flag(session, fake_aioredis.FakeRedis(decode_responses=True), "NOPE", True)


async def test_router_feature_flags_admin_only(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        admin = await _seed_user(db, role=UserRole.ADMIN, nickname="관리자")
        player = await _seed_user(db, nickname="플레이어")
    set_user(player)
    assert (await client.get("/api/game/admin/feature-flags")).status_code == 403
    assert (await client.put("/api/game/admin/feature-flags/QUIZ", json={"enabled": False})).status_code == 403

    set_user(admin)
    r = await client.get("/api/game/admin/feature-flags")
    assert r.status_code == 200
    assert [(f["key"], f["enabled"]) for f in r.json()] == [("QUIZ", True), ("STREAK", True)]

    r = await client.put("/api/game/admin/feature-flags/QUIZ", json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["updated_at"]
    r = await client.get("/api/game/admin/feature-flags")
    assert [(f["key"], f["enabled"]) for f in r.json()] == [("QUIZ", False), ("STREAK", True)]

    assert (await client.put("/api/game/admin/feature-flags/NOPE", json={"enabled": True})).status_code == 404
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k flag 2>&1 | tail -6`
Expected: ImportError → FAIL

- [ ] **Step 3: 서비스 작성**

`backend/apps/trading_game/services/feature_flag_service.py`:

```python
"""기능 on/off 플래그 (Phase 5b) — DB 원장 + Redis 30초 캐시.

행이 없으면 ON(마이그레이션 시드와 동일). Redis 장애 시 DB 를 직접 읽어 판정을 계속한다.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameFeatureFlag

log = logging.getLogger("trading_game.flags")

KNOWN_FLAGS = ("QUIZ", "STREAK")
CACHE_TTL_SECONDS = 30


class UnknownFlag(Exception):
    pass


def _cache_key(flag: str) -> str:
    return f"game:flag:{flag}"


async def _read_db(db: AsyncSession, flag: str) -> bool:
    row = await db.get(GameFeatureFlag, flag)
    return True if row is None else bool(row.enabled)


async def is_enabled(db: AsyncSession, redis, flag: str) -> bool:
    try:
        cached = await redis.get(_cache_key(flag))
    except Exception:
        log.warning("플래그 캐시 조회 실패 — DB 직접 조회 flag=%s", flag, exc_info=True)
        return await _read_db(db, flag)
    if cached is not None:
        return cached == "1"
    value = await _read_db(db, flag)
    try:
        await redis.set(_cache_key(flag), "1" if value else "0", ex=CACHE_TTL_SECONDS)
    except Exception:
        log.warning("플래그 캐시 저장 실패 flag=%s", flag, exc_info=True)
    return value


async def list_flags(db: AsyncSession) -> list[GameFeatureFlag]:
    rows = (
        await db.execute(select(GameFeatureFlag).where(GameFeatureFlag.key.in_(KNOWN_FLAGS)))
    ).scalars().all()
    by_key = {r.key: r for r in rows}
    # 행이 없는 플래그는 ON(미저장 객체)으로 채워 항상 KNOWN_FLAGS 순서로 반환
    return [by_key.get(k) or GameFeatureFlag(key=k, enabled=True, updated_at=None) for k in KNOWN_FLAGS]


async def set_flag(db: AsyncSession, redis, flag: str, enabled: bool) -> GameFeatureFlag:
    if flag not in KNOWN_FLAGS:
        raise UnknownFlag(flag)
    row = await db.get(GameFeatureFlag, flag)
    if row is None:
        row = GameFeatureFlag(key=flag)
        db.add(row)
    row.enabled = enabled
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    try:
        await redis.delete(_cache_key(flag))
    except Exception:
        log.warning("플래그 캐시 삭제 실패(최대 %ss 지연 반영) flag=%s", CACHE_TTL_SECONDS, flag, exc_info=True)
    return row
```

- [ ] **Step 4: DTO 추가** (`game_dtos.py` 끝)

```python
# ---------------------------------------------------------------- Phase 5b
class FeatureFlagResponse(BaseModel):
    key: str
    enabled: bool
    updated_at: datetime | None


class FeatureFlagUpdate(BaseModel):
    enabled: bool
```

- [ ] **Step 5: 라우터 작성**

`backend/apps/trading_game/routers/feature_flags.py`:

```python
"""기능 on/off 관리자 API (Phase 5b)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import FeatureFlagResponse, FeatureFlagUpdate
from apps.trading_game.services import feature_flag_service

router = APIRouter(prefix="/api/game/admin", tags=["trading-game-admin"])


def _dto(f) -> FeatureFlagResponse:
    return FeatureFlagResponse(key=f.key, enabled=f.enabled, updated_at=f.updated_at)


@router.get("/feature-flags", response_model=list[FeatureFlagResponse])
async def list_feature_flags(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return [_dto(f) for f in await feature_flag_service.list_flags(db)]


@router.put("/feature-flags/{key}", response_model=FeatureFlagResponse)
async def update_feature_flag(
    key: str,
    body: FeatureFlagUpdate,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await feature_flag_service.set_flag(db, deps.get_redis(), key, body.enabled)
    except feature_flag_service.UnknownFlag:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "알 수 없는 기능 플래그입니다.")
    return _dto(row)
```

- [ ] **Step 6: main.py 등록**

`from apps.trading_game.routers import coach, leaderboard, orders, ws_gateway` → `from apps.trading_game.routers import coach, feature_flags, leaderboard, orders, ws_gateway`, 그리고 `app.include_router(coach.router)` 다음 줄에 `app.include_router(feature_flags.router)`.

- [ ] **Step 7: 통과 + 회귀**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k flag 2>&1 | tail -6` → 4 passed
Run: `cd backend && uv run pytest -q 2>&1 | tail -5` → F/E 없음

- [ ] **Step 8: 커밋**

```bash
git add backend/apps/trading_game/services/feature_flag_service.py backend/apps/trading_game/routers/feature_flags.py backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/main.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 기능 on/off 플래그(QUIZ·STREAK) — DB+Redis 캐시, 관리자 API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: Streak 서비스 + `GET /api/game/streak/my`

**Files:**
- Create: `backend/apps/trading_game/services/streak_service.py`
- Create: `backend/apps/trading_game/routers/quiz.py` (이 태스크에서는 streak 엔드포인트만)
- Modify: `game_dtos.py`(StreakResponse), `main.py`
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- streak
from apps.trading_game.services import streak_service

D = date(2026, 10, 13)


@pytest.mark.parametrize("current, last, expected", [
    (0, None, 1),
    (3, D, 3),                       # 같은 날 — 유지
    (3, D - timedelta(days=1), 4),   # 어제 — +1
    (3, D - timedelta(days=2), 1),   # 하루 이상 공백 — 초기화
])
def test_next_streak(current, last, expected):
    assert streak_service.next_streak(current, last, D) == expected


async def test_touch_flow_and_highest(session):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    user = await _seed_user(session)
    r = await streak_service.touch(session, redis, user.id, today=D)
    assert (r.current_streak, r.highest_streak, r.last_activity_date) == (1, 1, D)
    r = await streak_service.touch(session, redis, user.id, today=D)
    assert r.current_streak == 1
    r = await streak_service.touch(session, redis, user.id, today=D + timedelta(days=1))
    assert (r.current_streak, r.highest_streak) == (2, 2)
    r = await streak_service.touch(session, redis, user.id, today=D + timedelta(days=4))
    assert (r.current_streak, r.highest_streak) == (1, 2)


async def test_touch_noop_when_streak_disabled(session):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    user = await _seed_user(session)
    await feature_flag_service.set_flag(session, redis, "STREAK", False)
    assert await streak_service.touch(session, redis, user.id, today=D) is None
    assert await session.get(UserStreak, user.id) is None


async def test_router_streak_my(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
    set_user(user)
    r = await client.get("/api/game/streak/my")
    assert r.status_code == 200
    assert r.json() == {"current_streak": 0, "highest_streak": 0, "last_activity_date": None, "enabled": True}

    async with maker() as db:
        await streak_service.touch(db, fake_redis, user.id, today=D)
        await feature_flag_service.set_flag(db, fake_redis, "STREAK", False)
    r = await client.get("/api/game/streak/my")
    assert r.json() == {"current_streak": 1, "highest_streak": 1, "last_activity_date": "2026-10-13", "enabled": False}
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k "streak" 2>&1 | tail -6` → ImportError FAIL

- [ ] **Step 3: 서비스 작성**

`backend/apps/trading_game/services/streak_service.py`:

```python
"""연속 출석(Streak) — KST 날짜 기준 (Phase 5b).

하루 중 주문 1회 이상 또는 퀴즈 제출 1회 이상이면 유지. STREAK 플래그가 꺼지면 갱신하지 않는다.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import UserStreak
from apps.trading_game.services import coach_service, feature_flag_service


def next_streak(current: int, last: date | None, today: date) -> int:
    if last == today:
        return current
    if last == today - timedelta(days=1):
        return current + 1
    return 1


async def touch(db: AsyncSession, redis, user_id: int, *, today: date | None = None) -> UserStreak | None:
    """오늘 활동 기록. 꺼져 있으면 None(무변경). commit 포함."""
    if not await feature_flag_service.is_enabled(db, redis, "STREAK"):
        return None
    today = today or coach_service.kst_today()
    row = await db.get(UserStreak, user_id)
    if row is None:
        row = UserStreak(user_id=user_id, current_streak=0, highest_streak=0)
        db.add(row)
    row.current_streak = next_streak(row.current_streak, row.last_activity_date, today)
    row.highest_streak = max(row.highest_streak, row.current_streak)
    row.last_activity_date = today
    await db.commit()
    return row


async def get_streak(db: AsyncSession, user_id: int) -> UserStreak | None:
    return await db.get(UserStreak, user_id)
```

- [ ] **Step 4: DTO 추가** (`game_dtos.py` 끝)

```python
class StreakResponse(BaseModel):
    current_streak: int
    highest_streak: int
    last_activity_date: date | None
    enabled: bool
```

- [ ] **Step 5: 라우터 작성**

`backend/apps/trading_game/routers/quiz.py`:

```python
"""야간 차트 퀴즈 + 연속 출석 REST (Phase 5b)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import StreakResponse
from apps.trading_game.services import feature_flag_service, streak_service

router = APIRouter(prefix="/api/game", tags=["trading-game-quiz"])
log = logging.getLogger("trading_game.quiz")


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
```

`main.py`: import 목록에 `quiz` 추가(`coach, feature_flags, leaderboard, orders, quiz, ws_gateway`), `app.include_router(feature_flags.router)` 다음에 `app.include_router(quiz.router)`.

- [ ] **Step 6: 통과 + 회귀** — `-k streak` 전부 PASS, 전체 F/E 없음

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/services/streak_service.py backend/apps/trading_game/routers/quiz.py backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/main.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 연속 출석(Streak) 서비스 + GET /api/game/streak/my

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 종가 캐시 추출 + 골든크로스 판정

**Files:**
- Modify: `backend/apps/trading_game/services/rsi_service.py` (`current_rsi` → `cached_closes` 분리)
- Create: `backend/apps/trading_game/services/indicators.py`
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- indicators / closes cache
from apps.trading_game.services import indicators, rsi_service

_BASE = [100.0] * 22  # MA5 == MA20 == 100 (교차 직전 '<=' 상태)


@pytest.mark.parametrize("extra, expected", [
    ([110.0], True),                       # 오늘 교차
    ([110.0, 110.0], True),                # 어제 교차
    ([110.0, 110.0, 110.0], True),         # 2거래일 전 교차(3거래일 이내)
    ([110.0, 110.0, 110.0, 110.0], False), # 3거래일 전 교차(4거래일째) — 불성립
    ([110.0, 60.0], False),                # 교차했지만 현재 MA5 < MA20
])
def test_golden_cross_within(extra, expected):
    assert indicators.golden_cross_within(_BASE + extra) is expected


def test_golden_cross_flat_and_short_input():
    assert indicators.golden_cross_within([100.0] * 40) is False
    assert indicators.golden_cross_within([100.0] * 10 + [110.0]) is False


async def test_cached_closes_caches_and_neg_caches():
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    calls = []

    async def provider(ticker, today):
        calls.append(ticker)
        return [1.0, 2.0]

    assert await rsi_service.cached_closes(redis, "005930", today=D, closes_provider=provider) == [1.0, 2.0]
    assert await rsi_service.cached_closes(redis, "005930", today=D, closes_provider=provider) == [1.0, 2.0]
    assert calls == ["005930"]  # 두 번째는 캐시

    async def boom(ticker, today):
        raise RuntimeError("ch down")

    assert await rsi_service.cached_closes(redis, "000660", today=D, closes_provider=boom) is None
    assert await redis.get(f"game:rsi:closes:000660:{D:%Y%m%d}:neg") == "1"
```

- [ ] **Step 2: 실패 확인** — `-k "golden or cached_closes"` → ImportError/AttributeError FAIL

- [ ] **Step 3: indicators 작성**

`backend/apps/trading_game/services/indicators.py`:

```python
"""차트 지표 순수 함수 (Phase 5b) — 골든크로스 판정."""
from __future__ import annotations

from typing import Sequence


def _ma(closes: Sequence[float], end: int, n: int) -> float:
    return sum(closes[end - n + 1:end + 1]) / n


def golden_cross_within(
    closes: Sequence[float], *, fast: int = 5, slow: int = 20, within: int = 3
) -> bool:
    """마지막 within 개 봉(오늘 포함) 안에서 fast MA 가 slow MA 를 아래→위로 교차했고 현재 fast > slow.

    교차 = 전봉 fast <= slow 이고 당봉 fast > slow. 데이터 부족이면 False.
    데드크로스는 부호를 뒤집은 시계열로 같은 함수를 호출해 판정할 수 있다.
    """
    if len(closes) < slow + within:
        return False
    last = len(closes) - 1
    if not _ma(closes, last, fast) > _ma(closes, last, slow):
        return False
    for i in range(last - within + 1, last + 1):
        prev_below = _ma(closes, i - 1, fast) <= _ma(closes, i - 1, slow)
        now_above = _ma(closes, i, fast) > _ma(closes, i, slow)
        if prev_below and now_above:
            return True
    return False
```

- [ ] **Step 4: rsi_service 리팩터** — `current_rsi` 함수 전체를 아래 두 함수로 교체(동작 동일: 빈/실패 → None, 음성 캐시 60초)

```python
async def cached_closes(
    redis,
    ticker: str,
    *,
    today: date | None = None,
    closes_provider: ClosesProvider = clickhouse_closes,
) -> list[float] | None:
    """오늘 이전 일봉 종가(하루 단위 캐시). 실패·빈 결과는 None — 예외를 던지지 않는다."""
    today = today or datetime.now(KST).date()
    key = _cache_key(ticker, today)
    neg_key = f"{key}:neg"
    try:
        raw = await redis.get(key)
        if raw is not None:
            return [float(x) for x in json.loads(raw)]
        if await redis.get(neg_key) is not None:  # 직전 실패/빈 응답 — 짧게 재조회 억제
            return None
        try:
            closes = await closes_provider(ticker, today)
        except Exception:
            await redis.set(neg_key, "1", ex=NEG_CACHE_TTL_SECONDS)
            raise
        if closes:
            await redis.set(key, json.dumps(closes), ex=CACHE_TTL_SECONDS)
            return closes
        # 빈 결과는 양성 캐시하지 않음(수집 지연 시 재시도) — 음성 캐시만 60초
        await redis.set(neg_key, "1", ex=NEG_CACHE_TTL_SECONDS)
        return None
    except Exception:
        log.warning("종가 조회 실패 ticker=%s", ticker, exc_info=True)
        return None


async def current_rsi(
    redis,
    ticker: str,
    live_price: Decimal,
    *,
    today: date | None = None,
    closes_provider: ClosesProvider = clickhouse_closes,
) -> float | None:
    """오늘 이전 종가(캐시) + live_price 로 RSI 계산. 실패·데이터 부족 시 None."""
    closes = await cached_closes(redis, ticker, today=today, closes_provider=closes_provider)
    if not closes:
        return None
    try:
        return wilder_rsi([*closes, float(live_price)])
    except Exception:
        log.warning("RSI 계산 실패 ticker=%s — 넛지 생략", ticker, exc_info=True)
        return None
```

모듈 docstring 첫 단락 끝에 한 줄 추가: `종가 캐시(cached_closes)는 Phase 5b 골든크로스 판정에서도 재사용한다.`

- [ ] **Step 5: 통과 + 5a RSI 테스트 회귀**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py tests/test_coach_and_nudge.py -v -k "golden or cached_closes or rsi" 2>&1 | tail -12` → 전부 PASS
Run: 전체 → F/E 없음

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/services/indicators.py backend/apps/trading_game/services/rsi_service.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 골든크로스 판정 + 일봉 종가 캐시(cached_closes) 추출

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 퀘스트 서비스 + `GET /quests`, `POST /quests/{code}/claim`

**Files:**
- Create: `backend/apps/trading_game/services/quest_service.py`
- Create: `backend/apps/trading_game/routers/quests.py`
- Modify: `game_dtos.py`, `main.py`
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- quests
from apps.trading_game.services import quest_service


@pytest.fixture
def closes_stub(monkeypatch):
    """rsi_service.cached_closes 를 고정(기본: 데이터 없음). value["v"] 로 교체(예외 객체면 raise)."""
    value: dict = {"v": None}

    async def stub(redis, ticker, **kw):
        if isinstance(value["v"], Exception):
            raise value["v"]
        return value["v"]

    monkeypatch.setattr(rsi_service, "cached_closes", stub)
    return value


async def _open(session, user, *, side="LONG", ratio=0.5, sl=None, price="110"):
    await quest_service.on_order_opened(
        session, fake_aioredis.FakeRedis(decode_responses=True), user.id,
        side=side, ratio=ratio, stop_loss_price=sl, ticker="005930", entry_price=Decimal(price),
    )


async def _progress(session, user, code):
    return await session.get(UserQuestProgress, (user.id, code), populate_existing=True)


async def test_q1_stop_loss_completes(session, closes_stub):
    user = await _seed_user(session)
    await _open(session, user, sl=None)
    assert (await _progress(session, user, "Q1_STOP_LOSS")) is None
    await _open(session, user, sl=Decimal("98"))
    row = await _progress(session, user, "Q1_STOP_LOSS")
    assert row.progress == 1 and row.completed_at is not None


async def test_q3_small_size_three_times(session, closes_stub):
    user = await _seed_user(session)
    await _open(session, user, ratio=0.5)
    assert (await _progress(session, user, "Q3_SMALL_SIZE")) is None
    for _ in range(3):
        await _open(session, user, ratio=0.25)
    row = await _progress(session, user, "Q3_SMALL_SIZE")
    assert row.progress == 3 and row.completed_at is not None
    await _open(session, user, ratio=0.25)
    assert (await _progress(session, user, "Q3_SMALL_SIZE")).progress == 3  # 완료 후 고정


async def test_q2_golden_cross_long_only(session, closes_stub):
    user = await _seed_user(session)
    closes_stub["v"] = [100.0] * 22  # + 현재가 110 → 오늘 교차
    await _open(session, user, side="SHORT")
    row = await _progress(session, user, "Q2_GOLDEN_CROSS")
    assert row is None or row.completed_at is None
    await _open(session, user, side="LONG", price="110")
    assert (await _progress(session, user, "Q2_GOLDEN_CROSS")).completed_at is not None


async def test_q2_skipped_on_closes_failure_or_timeout(session, closes_stub, monkeypatch):
    user = await _seed_user(session)
    closes_stub["v"] = RuntimeError("ch down")
    await _open(session, user, side="LONG", sl=Decimal("98"))  # 예외 없이 진행
    assert (await _progress(session, user, "Q1_STOP_LOSS")).completed_at is not None
    row = await _progress(session, user, "Q2_GOLDEN_CROSS")
    assert row is None or row.completed_at is None

    async def slow(redis, ticker, **kw):
        await asyncio.sleep(1)
        return [100.0] * 22

    monkeypatch.setattr(rsi_service, "cached_closes", slow)
    monkeypatch.setattr(quest_service, "GOLDEN_CROSS_TIMEOUT_SECONDS", 0.05)
    await _open(session, user, side="LONG", price="110")
    row = await _progress(session, user, "Q2_GOLDEN_CROSS")
    assert row is None or row.completed_at is None


async def test_claim_cash_reward_once(session, closes_stub):
    user = await _seed_user(session)
    season = await _seed_season(session)
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
    assert e.value.code == "QUEST_NOT_COMPLETED"

    await _open(session, user, sl=Decimal("98"))
    row, acc = await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
    assert row.claimed_at is not None
    assert acc.season_id == season.id
    assert acc.cash_balance == Decimal("10500000")
    assert acc.bonus_cash == Decimal("500000.00")  # ROI 0% → 같은 금액

    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
    assert e.value.code == "ALREADY_CLAIMED"


async def test_claim_without_active_season_keeps_unclaimed(session, closes_stub):
    user = await _seed_user(session)
    await _seed_season(session, status="FINISHED")
    await _open(session, user, sl=Decimal("98"))
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
    assert e.value.code == "NO_ACTIVE_SEASON"
    assert (await _progress(session, user, "Q1_STOP_LOSS")).claimed_at is None


async def test_claim_badge_without_season(session, closes_stub):
    user = await _seed_user(session)
    for _ in range(3):
        await _open(session, user, ratio=0.25)
    row, acc = await quest_service.claim(session, user.id, "Q3_SMALL_SIZE")
    assert acc is None and row.claimed_at is not None
    assert await session.get(UserBadge, (user.id, "PRINCIPLED")) is not None


async def test_claim_unknown_quest(session):
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, 1, "NOPE")
    assert e.value.code == "QUEST_NOT_FOUND"


async def test_router_quests(api, maker, fake_redis, closes_stub):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_season(db)
        await quest_service.on_order_opened(
            db, fake_redis, user.id, side="SHORT", ratio=0.5,
            stop_loss_price=Decimal("98"), ticker="005930", entry_price=Decimal("100"),
        )
    set_user(user)
    r = await client.get("/api/game/quests")
    assert r.status_code == 200
    data = r.json()
    assert [q["code"] for q in data["quests"]] == ["Q1_STOP_LOSS", "Q2_GOLDEN_CROSS", "Q3_SMALL_SIZE"]
    q1 = data["quests"][0]
    assert q1["completed"] is True and q1["claimed"] is False and q1["target"] == 1
    assert data["badges"] == []

    r = await client.post("/api/game/quests/Q1_STOP_LOSS/claim")
    assert r.status_code == 200, r.text
    assert r.json()["quest"]["claimed"] is True
    assert Decimal(r.json()["cash_balance"]) == Decimal("10500000")

    r = await client.post("/api/game/quests/Q1_STOP_LOSS/claim")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_CLAIMED"
    r = await client.post("/api/game/quests/Q2_GOLDEN_CROSS/claim")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "QUEST_NOT_COMPLETED"
    assert (await client.post("/api/game/quests/NOPE/claim")).status_code == 404
```

- [ ] **Step 2: 실패 확인** — `-k "q1 or q2 or q3 or claim or router_quests"` → ImportError FAIL

- [ ] **Step 3: 서비스 작성**

`backend/apps/trading_game/services/quest_service.py`:

```python
"""단계별 트레이딩 퀘스트 (Phase 5b) — 정의는 코드 상수, 진행은 user_quest_progress.

진행도는 유저 단위 영구 1회성. 현금 보상은 수령 시점 활성 시즌 계좌로 reward_service.grant_cash.
on_order_opened 는 주문 경로의 best-effort 훅 — 호출부가 예외를 흡수한다.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, UserBadge, UserQuestProgress
from apps.trading_game.services import account_service, indicators, reward_service, rsi_service

log = logging.getLogger("trading_game.quest")

GOLDEN_CROSS_TIMEOUT_SECONDS = 2.0
Q3_MAX_RATIO = Decimal("0.25")  # 주문 비중 선택지(25/50/100%) 중 최소

BADGE_NAMES = {"PRINCIPLED": "원칙주의자"}


@dataclass(frozen=True)
class QuestDef:
    code: str
    title: str
    description: str
    target: int
    reward_cash: Decimal | None = None
    reward_badge: str | None = None


QUESTS: tuple[QuestDef, ...] = (
    QuestDef("Q1_STOP_LOSS", "첫 손절선 걸고 거래하기",
             "손절선(Stop-Loss)을 설정하고 포지션에 진입하세요.", 1, reward_cash=Decimal("500000")),
    QuestDef("Q2_GOLDEN_CROSS", "골든크로스에 매수하기",
             "5일선이 20일선을 상향 돌파한 뒤 3거래일 이내에 LONG으로 진입하세요.", 1,
             reward_cash=Decimal("1000000")),
    QuestDef("Q3_SMALL_SIZE", "소분할 진입 3회",
             "자본금의 25% 이하 비중으로 3번 진입하세요.", 3, reward_badge="PRINCIPLED"),
)
QUEST_BY_CODE = {q.code: q for q in QUESTS}


class QuestError(Exception):
    """code: QUEST_NOT_FOUND | QUEST_NOT_COMPLETED | ALREADY_CLAIMED | NO_ACTIVE_SEASON"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


async def _get_or_create(db: AsyncSession, user_id: int, code: str) -> UserQuestProgress:
    row = await db.get(UserQuestProgress, (user_id, code))
    if row is None:
        row = UserQuestProgress(user_id=user_id, quest_code=code, progress=0)
        db.add(row)
    return row


def _advance(row: UserQuestProgress, quest: QuestDef, now: datetime) -> None:
    if row.completed_at is not None:
        return
    row.progress = min(row.progress + 1, quest.target)
    if row.progress >= quest.target:
        row.completed_at = now


async def _golden_cross_now(redis, ticker: str, price: Decimal) -> bool:
    try:
        closes = await asyncio.wait_for(
            rsi_service.cached_closes(redis, ticker), timeout=GOLDEN_CROSS_TIMEOUT_SECONDS
        )
    except Exception:
        log.warning("골든크로스 종가 조회 실패/지연 — Q2 판정 생략", exc_info=True)
        return False
    if not closes:
        return False
    return indicators.golden_cross_within([*closes, float(price)])


async def on_order_opened(
    db: AsyncSession,
    redis,
    user_id: int,
    *,
    side: str,
    ratio: float | Decimal,
    stop_loss_price: Decimal | None,
    ticker: str,
    entry_price: Decimal,
    now: datetime | None = None,
) -> None:
    now = now or datetime.now(timezone.utc)
    if stop_loss_price is not None:
        _advance(await _get_or_create(db, user_id, "Q1_STOP_LOSS"), QUEST_BY_CODE["Q1_STOP_LOSS"], now)
    if Decimal(str(ratio)) <= Q3_MAX_RATIO:
        _advance(await _get_or_create(db, user_id, "Q3_SMALL_SIZE"), QUEST_BY_CODE["Q3_SMALL_SIZE"], now)
    if side == "LONG":
        existing = await db.get(UserQuestProgress, (user_id, "Q2_GOLDEN_CROSS"))
        if (existing is None or existing.completed_at is None) and await _golden_cross_now(
            redis, ticker, entry_price
        ):
            _advance(
                await _get_or_create(db, user_id, "Q2_GOLDEN_CROSS"), QUEST_BY_CODE["Q2_GOLDEN_CROSS"], now
            )
    await db.commit()


async def list_progress(
    db: AsyncSession, user_id: int
) -> tuple[list[tuple[QuestDef, UserQuestProgress | None]], list[UserBadge]]:
    rows = (
        await db.execute(select(UserQuestProgress).where(UserQuestProgress.user_id == user_id))
    ).scalars().all()
    by_code = {r.quest_code: r for r in rows}
    badges = (
        await db.execute(
            select(UserBadge).where(UserBadge.user_id == user_id).order_by(UserBadge.awarded_at)
        )
    ).scalars().all()
    return [(q, by_code.get(q.code)) for q in QUESTS], list(badges)


async def claim(
    db: AsyncSession, user_id: int, code: str, *, now: datetime | None = None
) -> tuple[UserQuestProgress, GameAccount | None]:
    quest = QUEST_BY_CODE.get(code)
    if quest is None:
        raise QuestError("QUEST_NOT_FOUND", "존재하지 않는 퀘스트입니다.")
    row = await db.get(UserQuestProgress, (user_id, code))
    if row is None or row.completed_at is None:
        raise QuestError("QUEST_NOT_COMPLETED", "아직 달성하지 않은 퀘스트입니다.")
    if row.claimed_at is not None:
        raise QuestError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")

    account = None
    if quest.reward_cash is not None:
        season = await account_service.get_active_season(db)
        if season is None:
            raise QuestError("NO_ACTIVE_SEASON", "진행 중인 시즌이 없어 보상을 받을 수 없습니다.")
        account = await account_service.get_or_create_account(db, user_id, season.id)

    now = now or datetime.now(timezone.utc)
    # 조건부 갱신 — 연타·동시 요청에도 1회만 성공
    res = await db.execute(
        update(UserQuestProgress)
        .where(
            UserQuestProgress.user_id == user_id,
            UserQuestProgress.quest_code == code,
            UserQuestProgress.claimed_at.is_(None),
            UserQuestProgress.completed_at.is_not(None),
        )
        .values(claimed_at=now)
    )
    if res.rowcount != 1:
        await db.rollback()
        raise QuestError("ALREADY_CLAIMED", "이미 보상을 받았습니다.")
    if account is not None:
        await reward_service.grant_cash(db, account, quest.reward_cash)
    if quest.reward_badge is not None and await db.get(UserBadge, (user_id, quest.reward_badge)) is None:
        db.add(UserBadge(user_id=user_id, badge_code=quest.reward_badge, awarded_at=now))
    await db.commit()
    await db.refresh(row)
    if account is not None:
        await db.refresh(account)
    return row, account
```

- [ ] **Step 4: DTO 추가** (`game_dtos.py` 끝)

```python
class QuestResponse(BaseModel):
    code: str
    title: str
    description: str
    target: int
    progress: int
    reward_cash: Decimal | None
    reward_badge: str | None
    completed: bool
    claimed: bool


class BadgeDTO(BaseModel):
    code: str
    name: str
    awarded_at: datetime | None


class QuestListResponse(BaseModel):
    quests: list[QuestResponse]
    badges: list[BadgeDTO]


class QuestClaimResponse(BaseModel):
    quest: QuestResponse
    cash_balance: Decimal | None  # 현금 보상일 때 지급 후 잔고
    badge: BadgeDTO | None
```

- [ ] **Step 5: 라우터 작성**

`backend/apps/trading_game/routers/quests.py`:

```python
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
```

`main.py`: import 목록에 `quests` 추가, `app.include_router(quiz.router)` 다음에 `app.include_router(quests.router)`.

- [ ] **Step 6: 통과 + 회귀** — 신규 테스트 PASS, 전체 F/E 없음

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/services/quest_service.py backend/apps/trading_game/routers/quests.py backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/main.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 단계별 퀘스트(Q1 손절·Q2 골든크로스·Q3 소분할) 진행·보상 수령 API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 아카데미 + 5배 레버리지 잠금

**Files:**
- Create: `backend/apps/trading_game/services/academy_service.py`
- Create: `backend/apps/trading_game/routers/academy.py`
- Modify: `backend/apps/trading_game/routers/orders.py` (`open_order`에 잠금 검사)
- Modify: `game_dtos.py`, `main.py`
- Modify: `backend/tests/test_coach_and_nudge.py` (5배 주문 테스트 2건 해금 시드)
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- academy + 5x lock
from apps.trading_game.routers import orders as orders_router
from apps.trading_game.services import academy_service

ALL_CORRECT = {q.id: q.answer for q in academy_service.QUESTIONS}


@pytest.fixture
def order_env(monkeypatch, fake_redis, closes_stub):
    """거래창·신선가 고정 + RSI/종가 CH 조회 차단. price["v"] 로 가격 변경."""
    price = {"v": Decimal("100")}

    async def fresh(_redis, _ticker):
        return price["v"]

    async def no_rsi(*a, **k):
        return None

    monkeypatch.setattr(orders_router.market_clock, "in_trading_window", lambda *a, **k: True)
    monkeypatch.setattr(orders_router, "_require_fresh_price", fresh)
    monkeypatch.setattr(orders_router.rsi_service, "current_rsi", no_rsi)
    return price


def _order(season_id, **over):
    b = {"season_id": season_id, "side": "LONG", "ratio": 0.5, "leverage": 1}
    b.update(over)
    return b


async def test_academy_submit_unlock_and_retry(session):
    user = await _seed_user(session)
    wrong = dict(ALL_CORRECT)
    first = academy_service.QUESTIONS[0]
    wrong[first.id] = (first.answer + 1) % len(first.choices)
    results, unlocked = await academy_service.submit(session, user.id, wrong)
    assert unlocked is False
    assert [r["correct"] for r in results] == [False, True, True]
    assert await academy_service.is_unlocked(session, user.id) is False

    results, unlocked = await academy_service.submit(session, user.id, ALL_CORRECT)
    assert unlocked is True and all(r["correct"] for r in results)
    row = await session.get(UserAcademy, user.id)
    assert row.unlocked_leverage_5x is True and row.passed_at is not None and row.attempts == 2


async def test_academy_missing_answer_is_wrong(session):
    user = await _seed_user(session)
    partial = {k: v for k, v in ALL_CORRECT.items() if k != academy_service.QUESTIONS[-1].id}
    _, unlocked = await academy_service.submit(session, user.id, partial)
    assert unlocked is False


async def test_router_academy_quiz_hides_answers(api, maker):
    client, set_user = api
    async with maker() as db:
        set_user(await _seed_user(db))
    r = await client.get("/api/game/academy/quiz")
    assert r.status_code == 200
    data = r.json()
    assert data["unlocked"] is False and len(data["questions"]) == 3
    assert all(set(q) == {"id", "question", "choices"} for q in data["questions"])

    r = await client.post(
        "/api/game/academy/submit", json={"answers": {str(k): v for k, v in ALL_CORRECT.items()}}
    )
    assert r.status_code == 200 and r.json()["unlocked"] is True
    assert all("explanation" in x for x in r.json()["results"])


async def test_5x_locked_until_academy_passed(api, maker, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
    set_user(user)
    r = await client.post("/api/game/orders", json=_order(season.id, leverage=5))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "LEVERAGE_LOCKED"

    r = await client.post("/api/game/orders", json=_order(season.id, leverage=2))
    assert r.status_code == 201, r.text
    assert (await client.post(f"/api/game/positions/{r.json()['id']}/close")).status_code == 200

    async with maker() as db:
        await academy_service.submit(db, user.id, ALL_CORRECT)
    r = await client.post("/api/game/orders", json=_order(season.id, leverage=5))
    assert r.status_code == 201, r.text
```

- [ ] **Step 2: 실패 확인** — `-k "academy or 5x"` → ImportError FAIL

- [ ] **Step 3: 서비스 작성**

`backend/apps/trading_game/services/academy_service.py`:

```python
"""아카데미 — 리스크 관리 미니 퀴즈(3문항) 통과 시 5배 레버리지 해금 (Phase 5b).

문항은 코드 고정(정답 인덱스 0-based). 재응시 무제한.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import UserAcademy


@dataclass(frozen=True)
class AcademyQuestion:
    id: int
    question: str
    choices: tuple[str, ...]
    answer: int
    explanation: str


QUESTIONS: tuple[AcademyQuestion, ...] = (
    AcademyQuestion(
        1, "5배 레버리지로 LONG 진입한 뒤 주가가 16% 하락하면 어떻게 될까요?",
        ("16% 손실", "32% 손실", "증거금 80% 손실로 강제 청산(마진콜)", "손실 없음"), 2,
        "레버리지 5배에서는 주가 -16%가 증거금 -80%에 해당해 마진콜로 강제 청산됩니다.",
    ),
    AcademyQuestion(
        2, "손절선(Stop-Loss)을 미리 정해 두는 가장 큰 이유는?",
        ("수익을 키우기 위해", "감정에 휘둘리지 않고 손실을 제한하기 위해", "수수료를 줄이기 위해", "거래 횟수를 늘리기 위해"), 1,
        "손절선은 '얼마까지 잃을지'를 진입 전에 정해 감정적인 버티기를 막아 줍니다.",
    ),
    AcademyQuestion(
        3, "자금 관리 원칙으로 가장 적절한 것은?",
        ("한 번에 전 재산을 건다", "손실을 만회하려고 비중을 늘린다", "한 번의 거래에는 자본의 일부만 쓴다", "항상 최대 레버리지를 쓴다"), 2,
        "한 번의 실수로 게임이 끝나지 않도록 거래당 비중을 작게 유지하는 것이 기본입니다.",
    ),
)


async def is_unlocked(db: AsyncSession, user_id: int) -> bool:
    row = await db.get(UserAcademy, user_id)
    return bool(row and row.unlocked_leverage_5x)


async def submit(
    db: AsyncSession, user_id: int, answers: dict[int, int], *, now: datetime | None = None
) -> tuple[list[dict], bool]:
    """채점 → (문항별 결과, 해금 여부). 미응답 문항은 오답. commit 포함."""
    results = [
        {"id": q.id, "correct": answers.get(q.id) == q.answer, "answer": q.answer, "explanation": q.explanation}
        for q in QUESTIONS
    ]
    passed = all(r["correct"] for r in results)
    row = await db.get(UserAcademy, user_id)
    if row is None:
        row = UserAcademy(user_id=user_id, unlocked_leverage_5x=False, attempts=0)
        db.add(row)
    row.attempts += 1
    if passed and not row.unlocked_leverage_5x:
        row.unlocked_leverage_5x = True
        row.passed_at = now or datetime.now(timezone.utc)
    await db.commit()
    return results, row.unlocked_leverage_5x
```

- [ ] **Step 4: DTO 추가** (`game_dtos.py` 끝)

```python
class AcademyQuestionDTO(BaseModel):
    id: int
    question: str
    choices: list[str]


class AcademyQuizResponse(BaseModel):
    unlocked: bool
    questions: list[AcademyQuestionDTO]


class AcademySubmitRequest(BaseModel):
    answers: dict[int, int]  # 문항 id → 선택 인덱스(0-based)


class AcademyResultItem(BaseModel):
    id: int
    correct: bool
    answer: int
    explanation: str


class AcademySubmitResponse(BaseModel):
    unlocked: bool
    results: list[AcademyResultItem]
```

- [ ] **Step 5: 라우터 작성**

`backend/apps/trading_game/routers/academy.py`:

```python
"""아카데미(5배 레버리지 해금 퀴즈) REST (Phase 5b)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
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
            for q in academy_service.QUESTIONS
        ],
    )


@router.post("/submit", response_model=AcademySubmitResponse)
async def academy_submit(
    body: AcademySubmitRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    results, unlocked = await academy_service.submit(db, user.id, body.answers)
    return AcademySubmitResponse(unlocked=unlocked, results=[AcademyResultItem(**r) for r in results])
```

`main.py`: import 목록에 `academy` 추가, `app.include_router(quests.router)` 다음에 `app.include_router(academy.router)`.

- [ ] **Step 6: orders.py 잠금 검사**

`backend/apps/trading_game/routers/orders.py`:
- services import 묶음에 `academy_service` 추가(`account_service, academy_service, market_clock, ...`).
- `open_order`에서 시즌 검사(`raise HTTPException(status.HTTP_409_CONFLICT, "거래 가능한 ACTIVE 시즌이 아닙니다.")`) 바로 다음에 추가:

```python
    # Phase 5b: 5배 레버리지는 아카데미 통과자만(필수 게이트 — 체결 전에 거부)
    if body.leverage == 5 and not await academy_service.is_unlocked(db, user.id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "LEVERAGE_LOCKED",
                    "message": "5배 레버리지는 아카데미 리스크 관리 퀴즈를 통과해야 사용할 수 있습니다."},
        )
```

- [ ] **Step 7: 기존 5a 테스트 2건 수정(의도된 동작 변경)**

`backend/tests/test_coach_and_nudge.py`:
- `from shared.game_models import GameCoachMessage, GameSeason` → `from shared.game_models import GameCoachMessage, GameSeason, UserAcademy`
- `_seed_player` 함수 바로 아래에 추가:

```python
async def _seed_unlocked_player(db) -> User:
    """Phase 5b: 5배 레버리지는 아카데미 해금자만 주문 가능."""
    u = await _seed_player(db)
    db.add(UserAcademy(user_id=u.id, unlocked_leverage_5x=True))
    await db.commit()
    return u
```
- `test_open_order_returns_warning_and_advice`와 `test_open_order_rsi_timeout_keeps_overleverage`의 `set_user(await _seed_player(db))` → `set_user(await _seed_unlocked_player(db))` (이 두 테스트만).

- [ ] **Step 8: 통과 + 회귀**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k "academy or 5x" 2>&1 | tail -6` → PASS
Run: `cd backend && uv run pytest -q 2>&1 | tail -5` → F/E 없음(5a 두 테스트 포함)

- [ ] **Step 9: 커밋**

```bash
git add backend/apps/trading_game/services/academy_service.py backend/apps/trading_game/routers/academy.py backend/apps/trading_game/routers/orders.py backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/main.py backend/tests/test_quest_quiz_streak.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 아카데미 리스크 퀴즈 + 5배 레버리지 잠금(LEVERAGE_LOCKED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 주문 훅 — 퀘스트·Streak 갱신(best-effort)

**Files:**
- Modify: `backend/apps/trading_game/routers/orders.py`
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- order hooks
async def test_order_updates_quest_and_streak(api, maker, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
    set_user(user)
    r = await client.post("/api/game/orders", json=_order(season.id, ratio=0.25, stop_loss_pct=0.02))
    assert r.status_code == 201, r.text
    async with maker() as db:
        q1 = await db.get(UserQuestProgress, (user.id, "Q1_STOP_LOSS"))
        q3 = await db.get(UserQuestProgress, (user.id, "Q3_SMALL_SIZE"))
        st = await db.get(UserStreak, user.id)
    assert q1 is not None and q1.completed_at is not None
    assert q3 is not None and q3.progress == 1
    assert st is not None and st.current_streak == 1


async def test_order_succeeds_when_hooks_fail(api, maker, order_env, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
    set_user(user)

    async def boom(*a, **k):
        raise RuntimeError("hook bug")

    monkeypatch.setattr(orders_router.quest_service, "on_order_opened", boom)
    monkeypatch.setattr(orders_router.streak_service, "touch", boom)
    r = await client.post("/api/game/orders", json=_order(season.id, stop_loss_pct=0.02))
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "OPEN" and r.json()["stop_loss_price"] is not None


async def test_order_streak_off_not_recorded(api, maker, order_env, fake_redis):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
        await feature_flag_service.set_flag(db, fake_redis, "STREAK", False)
    set_user(user)
    assert (await client.post("/api/game/orders", json=_order(season.id))).status_code == 201
    async with maker() as db:
        assert await db.get(UserStreak, user.id) is None
```

- [ ] **Step 2: 실패 확인** — `-k "order_updates or hooks_fail or streak_off"` → 첫 테스트 FAIL(q1 None), 두 번째 AttributeError(`orders_router.quest_service` 없음)

- [ ] **Step 3: orders.py 수정**

- services import 묶음에 `quest_service`, `streak_service` 추가(알파벳 순).
- `_close_nudges` 함수 아래에 추가:

```python
async def _after_open_hooks(
    db: AsyncSession, redis, user_id: int, body: OrderRequest, ticker: str,
    entry_price: Decimal, stop_loss_price: Decimal | None,
) -> None:
    """퀘스트·Streak 갱신 — best-effort(실패해도 체결 응답 유지).

    응답 DTO 를 만든 '뒤'에 호출할 것: 실패 시 rollback 이 세션 객체를 expire 시킨다.
    """
    try:
        await quest_service.on_order_opened(
            db, redis, user_id, side=body.side, ratio=body.ratio,
            stop_loss_price=stop_loss_price, ticker=ticker, entry_price=entry_price,
        )
    except Exception:
        log.warning("퀘스트 갱신 실패(주문은 정상 체결) user=%s", user_id, exc_info=True)
        await _safe_rollback(db)
    try:
        await streak_service.touch(db, redis, user_id)
    except Exception:
        log.warning("Streak 갱신 실패(주문은 정상 체결) user=%s", user_id, exc_info=True)
        await _safe_rollback(db)


async def _safe_rollback(db: AsyncSession) -> None:
    try:
        await db.rollback()
    except Exception:
        log.warning("훅 실패 후 rollback 실패", exc_info=True)
```

- `open_order` 끝부분

```python
    dto = _position_dto(pos, roi, pnl)
    nudges = await _open_nudges(redis, season.ticker, body, entry_price)
    return OrderResultResponse(**dto.model_dump(), nudges=nudges)
```
를 다음으로 교체:

```python
    dto = _position_dto(pos, roi, pnl)
    nudges = await _open_nudges(redis, season.ticker, body, entry_price)
    await _after_open_hooks(
        db, redis, user.id, body, season.ticker, entry_price, dto.stop_loss_price
    )
    return OrderResultResponse(**dto.model_dump(), nudges=nudges)
```

- [ ] **Step 4: 통과 + 회귀** — 3개 PASS, 전체 F/E 없음

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/routers/orders.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 주문 직후 퀘스트·Streak 갱신 훅(best-effort)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: 야간 차트 퀴즈 출제·채점 API

**Files:**
- Create: `backend/apps/trading_game/services/quiz_service.py`
- Modify: `backend/apps/trading_game/routers/quiz.py`
- Modify: `game_dtos.py`
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- chart quiz
from apps.trading_game.services import quiz_service

T0 = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)  # KST 21:00


async def _seed_quizzes(db, n: int, answer: str = "UP") -> list[ChartQuiz]:
    out = []
    for i in range(n):
        q = ChartQuiz(
            ticker="005930", base_date=date(2026, 1, 1) + timedelta(days=i), pattern_type="정배열",
            chart_snapshot=[{"date": "2026-01-01", "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0, "volume": 1}],
            answer=answer, actual_change=Decimal("2.50"), explanation=f"해설{i}",
        )
        db.add(q)
        out.append(q)
    await db.commit()
    return out


async def test_serve_random_excludes_attempted_and_exhausts(session):
    user = await _seed_user(session)
    await _seed_quizzes(session, 2)
    a = await quiz_service.serve_random(session, user.id, now=T0)
    b = await quiz_service.serve_random(session, user.id, now=T0)
    assert a.id != b.id
    with pytest.raises(quiz_service.QuizError) as e:
        await quiz_service.serve_random(session, user.id, now=T0)
    assert e.value.code == "NO_QUIZ_AVAILABLE"


async def test_submit_correct_rewards_and_rejects_resubmit(session):
    user = await _seed_user(session)
    await _seed_season(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "UP", now=T0 + timedelta(seconds=5))
    assert res.correct is True and res.rewarded is True and res.timed_out is False
    acc = (await session.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
    await session.refresh(acc)
    assert acc.cash_balance == Decimal("10200000")
    with pytest.raises(quiz_service.QuizError) as e:
        await quiz_service.submit(session, user.id, q.id, "UP", now=T0 + timedelta(seconds=6))
    assert e.value.code == "ALREADY_SUBMITTED"


async def test_submit_not_served(session):
    user = await _seed_user(session)
    q = (await _seed_quizzes(session, 1))[0]
    with pytest.raises(quiz_service.QuizError) as e:
        await quiz_service.submit(session, user.id, q.id, "UP", now=T0)
    assert e.value.code == "QUIZ_NOT_SERVED"


@pytest.mark.parametrize("elapsed, timed_out", [(13, False), (13.5, True)])
async def test_submit_time_limit(session, elapsed, timed_out):
    user = await _seed_user(session)
    await _seed_season(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "UP", now=T0 + timedelta(seconds=elapsed))
    assert res.timed_out is timed_out
    assert res.correct is (not timed_out)
    assert res.rewarded is (not timed_out)


async def test_submit_wrong_no_reward(session):
    user = await _seed_user(session)
    await _seed_season(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "DOWN", now=T0 + timedelta(seconds=3))
    assert res.correct is False and res.rewarded is False


async def test_daily_reward_limit_three(session):
    user = await _seed_user(session)
    await _seed_season(session)
    await _seed_quizzes(session, 5)
    rewarded = []
    for _ in range(4):
        q = await quiz_service.serve_random(session, user.id, now=T0)
        res = await quiz_service.submit(session, user.id, q.id, "UP", now=T0 + timedelta(seconds=2))
        rewarded.append(res.rewarded)
    assert rewarded == [True, True, True, False]
    # 다음 날(KST)에는 다시 보상
    t1 = T0 + timedelta(days=1)
    q = await quiz_service.serve_random(session, user.id, now=t1)
    assert (await quiz_service.submit(session, user.id, q.id, "UP", now=t1 + timedelta(seconds=2))).rewarded is True


async def test_router_quiz_flow(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_season(db)
        await _seed_quizzes(db, 1)
    set_user(user)
    r = await client.get("/api/game/quiz/random")
    assert r.status_code == 200, r.text
    data = r.json()
    assert set(data) == {"id", "ticker", "chart_snapshot", "time_limit_sec"}
    assert data["time_limit_sec"] == 10

    r = await client.post(f"/api/game/quiz/{data['id']}/submit", json={"choice": "UP"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is True and body["answer"] == "UP" and body["rewarded"] is True
    assert body["explanation"] == "해설0" and body["streak"]["current_streak"] == 1

    r = await client.post(f"/api/game/quiz/{data['id']}/submit", json={"choice": "UP"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_SUBMITTED"
    r = await client.get("/api/game/quiz/random")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NO_QUIZ_AVAILABLE"
    assert (await client.post("/api/game/quiz/999/submit", json={"choice": "UP"})).status_code == 409
    assert (await client.post(f"/api/game/quiz/{data['id']}/submit", json={"choice": "SIDE"})).status_code == 422


async def test_router_quiz_disabled(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_quizzes(db, 1)
        await feature_flag_service.set_flag(db, fake_redis, "QUIZ", False)
    set_user(user)
    r = await client.get("/api/game/quiz/random")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FEATURE_DISABLED"
    assert (await client.post("/api/game/quiz/1/submit", json={"choice": "UP"})).status_code == 503
```

- [ ] **Step 2: 실패 확인** — `-k "quiz or serve_random or submit or daily_reward"` → ImportError FAIL

- [ ] **Step 3: 서비스 작성**

`backend/apps/trading_game/services/quiz_service.py`:

```python
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
```

- [ ] **Step 4: DTO 추가** (`game_dtos.py` 끝)

```python
class QuizQuestionResponse(BaseModel):
    id: int
    ticker: str
    chart_snapshot: list[dict]
    time_limit_sec: int


class QuizSubmitRequest(BaseModel):
    choice: Literal["UP", "DOWN"]


class QuizSubmitResponse(BaseModel):
    correct: bool
    answer: str
    actual_change: Decimal
    pattern_type: str
    explanation: str
    rewarded: bool
    reward_cash: int
    timed_out: bool
    streak: StreakResponse | None
```

- [ ] **Step 5: 라우터 확장** — `backend/apps/trading_game/routers/quiz.py`

import 수정:

```python
from fastapi import APIRouter, Depends, HTTPException, status
```
```python
from apps.trading_game.schemas.game_dtos import (
    QuizQuestionResponse, QuizSubmitRequest, QuizSubmitResponse, StreakResponse,
)
from apps.trading_game.services import feature_flag_service, quiz_service, streak_service
```

`my_streak` 위에 추가:

```python
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
        raise HTTPException(_ERROR_STATUS[e.code], detail={"code": e.code, "message": str(e)})
    return QuizQuestionResponse(
        id=quiz.id, ticker=quiz.ticker, chart_snapshot=quiz.chart_snapshot,
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
        res = await quiz_service.submit(db, user.id, quiz_id, body.choice)
    except quiz_service.QuizError as e:
        raise HTTPException(_ERROR_STATUS[e.code], detail={"code": e.code, "message": str(e)})
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
        timed_out=res.timed_out, streak=streak,
    )
```

- [ ] **Step 6: 통과 + 회귀** — 신규 PASS, 전체 F/E 없음

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/services/quiz_service.py backend/apps/trading_game/routers/quiz.py backend/apps/trading_game/schemas/game_dtos.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 야간 차트 퀴즈 출제·채점(서버 10초 제한·일일 보상 3회)·Streak 연동

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 10: 퀴즈 자동 생성 스크립트

**Files:**
- Create: `backend/scripts/generate_chart_quiz.py` (`backend/scripts/`는 이미 `__init__.py`가 있는 패키지)
- Test: `backend/tests/test_quest_quiz_streak.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- quiz generator
import random

from scripts import generate_chart_quiz as gen


def _candles(closes: list[float], start=date(2026, 1, 1)) -> list[dict]:
    return [
        {"date": (start + timedelta(days=i)).isoformat(), "open": c, "high": c, "low": c, "close": c, "volume": 100}
        for i, c in enumerate(closes)
    ]


@pytest.mark.parametrize("closes, pattern", [
    ([100.0] * 59 + [110.0], "골든크로스"),
    ([100.0] * 59 + [90.0], "데드크로스"),
    ([float(i) for i in range(1, 61)], "정배열"),
    ([float(i) for i in range(60, 0, -1)], "역배열"),
])
def test_build_explanation_patterns(closes, pattern):
    p, md = gen.build_explanation(closes)
    assert p == pattern
    assert "RSI(14)" in md and "5일선" in md


def test_make_quiz_answer_window_and_filters():
    closes = [100.0] * 60 + [100.0, 101.0, 102.0, 103.0, 103.0]  # 기준(idx59)=100 → 5봉 뒤 103 → +3%
    c = _candles(closes)
    q = gen.make_quiz("005930", c, 59)
    assert q["answer"] == "UP" and q["actual_change"] == Decimal("3.00")
    assert len(q["chart_snapshot"]) == 60 and q["chart_snapshot"][-1]["date"] == c[59]["date"]
    assert q["base_date"] == date.fromisoformat(c[59]["date"])
    flat = _candles([100.0] * 60 + [100.5] * 5)  # +0.5% → 애매 → 제외
    assert gen.make_quiz("005930", flat, 59) is None
    assert gen.make_quiz("005930", c, 58) is None  # 60봉 미만
    assert gen.make_quiz("005930", c, 60) is None  # 이후 5봉 부족


async def test_generate_inserts_and_is_idempotent(maker):
    closes = [100.0 + (i % 7) * 3 for i in range(120)]  # 5봉 뒤 항상 2.5% 이상 차이
    candles = _candles(closes)

    def tickers():
        return ["005930"]

    def fetch(ticker):
        return candles

    created, skipped = await gen.generate(5, rng=random.Random(0), fetch_tickers=tickers,
                                          fetch_candles=fetch, session_factory=maker)
    assert created == 5 and skipped == 0
    created2, skipped2 = await gen.generate(5, rng=random.Random(0), fetch_tickers=tickers,
                                            fetch_candles=fetch, session_factory=maker)
    assert created2 == 0 and skipped2 == 5
    async with maker() as db:
        rows = (await db.execute(select(ChartQuiz))).scalars().all()
    assert len(rows) == 5
    assert all(r.answer in ("UP", "DOWN") and abs(r.actual_change) >= Decimal("1") for r in rows)
```

- [ ] **Step 2: 실패 확인** — `-k "build_explanation or make_quiz or generate_inserts"` → ImportError FAIL

- [ ] **Step 3: 스크립트 작성**

`backend/scripts/generate_chart_quiz.py`:

```python
"""야간 차트 퀴즈 자동 생성 (Phase 5b, 멱등).

ClickHouse daily_prices 에서 종목·기준일을 무작위로 골라 기준일까지 60봉을 문제로,
이후 5봉 종가 변동률로 정답(UP/DOWN)을 정한다. |변동률| < 1% 인 애매한 구간은 버린다.
해설은 기준일 RSI(14)·5/20일 이동평균 상태로 만든 규칙 기반 템플릿.
(ticker, base_date) 가 이미 있으면 건너뛰므로 재실행해도 중복이 생기지 않는다.

실행:
    cd backend
    uv run python -m scripts.generate_chart_quiz --count 50 [--seed 42]

주의: 운영 DB에는 실행하지 말 것. 로컬/개발 DB에서만 사용한다.
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import ChartQuiz
from apps.trading_game.services import indicators, rsi_service

WINDOW = 60
HORIZON = 5
MIN_ABS_CHANGE = 1.0
LOOKBACK_DAYS = 3 * 365


def _avg(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def build_explanation(closes: list[float]) -> tuple[str, str]:
    """기준일까지 종가 → (pattern_type, 해설 마크다운)."""
    ma5, ma20 = _avg(closes[-5:]), _avg(closes[-20:])
    rsi = rsi_service.wilder_rsi(closes)
    if indicators.golden_cross_within(closes):
        pattern, ma_desc = "골든크로스", "5일선이 20일선을 막 상향 돌파했습니다. 단기 상승 전환 신호로 자주 해석됩니다."
    elif indicators.golden_cross_within([-c for c in closes]):  # 부호 반전 = 데드크로스
        pattern, ma_desc = "데드크로스", "5일선이 20일선을 막 하향 돌파했습니다. 단기 하락 전환 신호로 자주 해석됩니다."
    elif ma5 > ma20:
        pattern, ma_desc = "정배열", "5일선이 20일선 위에 있어 단기 추세가 우상향입니다."
    else:
        pattern, ma_desc = "역배열", "5일선이 20일선 아래에 있어 단기 추세가 약합니다."
    if rsi is None:
        rsi_text, rsi_desc = "-", "데이터가 부족해 RSI를 계산하지 못했습니다."
    elif rsi >= 70:
        rsi_text, rsi_desc = f"{rsi:.1f}", "과매수 구간 — 추격 매수는 되돌림 위험이 큽니다."
    elif rsi <= 30:
        rsi_text, rsi_desc = f"{rsi:.1f}", "과매도 구간 — 기술적 반등이 나올 수 있는 자리입니다."
    else:
        rsi_text, rsi_desc = f"{rsi:.1f}", "중립 구간입니다."
    md = (
        f"### {pattern}\n"
        f"- 5일선 {ma5:,.0f} / 20일선 {ma20:,.0f}: {ma_desc}\n"
        f"- RSI(14) {rsi_text}: {rsi_desc}\n\n"
        "> 패턴은 확률일 뿐 확정이 아닙니다. 손절 원칙과 함께 활용하세요."
    )
    return pattern, md


def make_quiz(ticker: str, candles: list[dict], base_idx: int) -> dict | None:
    """candles[base_idx] 를 기준일로 퀴즈 1개. 조건 미달이면 None."""
    if base_idx < WINDOW - 1 or base_idx + HORIZON >= len(candles):
        return None
    window = candles[base_idx - WINDOW + 1:base_idx + 1]
    base_close = float(candles[base_idx]["close"])
    future_close = float(candles[base_idx + HORIZON]["close"])
    change = round((future_close - base_close) / base_close * 100, 2)
    if abs(change) < MIN_ABS_CHANGE:
        return None
    pattern, explanation = build_explanation([float(c["close"]) for c in window])
    return {
        "ticker": ticker,
        "base_date": date.fromisoformat(str(candles[base_idx]["date"])[:10]),
        "pattern_type": pattern,
        "chart_snapshot": window,
        "answer": "UP" if change > 0 else "DOWN",
        "actual_change": Decimal(f"{change:.2f}"),
        "explanation": explanation,
    }


def _fetch_tickers() -> list[str]:
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

    rows = get_client().query(f"SELECT DISTINCT ticker FROM {CLICKHOUSE_DB}.daily_prices FINAL").result_rows
    return [r[0] for r in rows]


def _fetch_candles(ticker: str) -> list[dict]:
    # 의도적 cross-app import(rsi_service 와 같은 선례), 지연 import
    from apps.stock_api.services import clickhouse_source

    end = date.today()
    start = end - timedelta(days=LOOKBACK_DAYS)
    candles = clickhouse_source.get_candles(ticker, start.isoformat(), end.isoformat()) or []
    return [
        {"date": str(c.date)[:10], "open": c.open, "high": c.high, "low": c.low, "close": c.close, "volume": c.volume}
        for c in candles
    ]


async def insert_quizzes(db, quizzes: list[dict]) -> tuple[int, int]:
    created = skipped = 0
    for q in quizzes:
        exists = (
            await db.execute(
                select(ChartQuiz.id).where(ChartQuiz.ticker == q["ticker"], ChartQuiz.base_date == q["base_date"])
            )
        ).scalar_one_or_none()
        if exists is not None:
            skipped += 1
            continue
        db.add(ChartQuiz(**q))
        created += 1
    await db.commit()
    return created, skipped


async def generate(
    count: int,
    *,
    rng: random.Random,
    fetch_tickers: Callable[[], list[str]] = _fetch_tickers,
    fetch_candles: Callable[[str], list[dict]] = _fetch_candles,
    session_factory=AsyncSessionLocal,
) -> tuple[int, int]:
    tickers = fetch_tickers()
    cache: dict[str, list[dict]] = {}
    quizzes: list[dict] = []
    seen: set[tuple[str, date]] = set()
    tries = 0
    while tickers and len(quizzes) < count and tries < count * 20:
        tries += 1
        t = rng.choice(tickers)
        if t not in cache:
            cache[t] = fetch_candles(t)
        candles = cache[t]
        if len(candles) < WINDOW + HORIZON:
            continue
        q = make_quiz(t, candles, rng.randint(WINDOW - 1, len(candles) - HORIZON - 1))
        if q is None or (t, q["base_date"]) in seen:
            continue
        seen.add((t, q["base_date"]))
        quizzes.append(q)
    async with session_factory() as db:
        return await insert_quizzes(db, quizzes)


def main() -> None:
    parser = argparse.ArgumentParser(description="야간 차트 퀴즈 자동 생성")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    created, skipped = asyncio.run(generate(args.count, rng=random.Random(args.seed)))
    print(f"[generate_chart_quiz] created={created}, skipped(duplicate)={skipped}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && uv run pytest tests/test_quest_quiz_streak.py -v -k "build_explanation or make_quiz or generate_inserts" 2>&1 | tail -8` → PASS
Run: 전체 → F/E 없음

- [ ] **Step 5: 커밋**

```bash
git add backend/scripts/generate_chart_quiz.py backend/tests/test_quest_quiz_streak.py
git commit -m "feat(game): 야간 차트 퀴즈 자동 생성 스크립트(CH 일봉·규칙 기반 해설·멱등)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 11: admin_web 기능 설정 화면

**Files:**
- Modify: `admin_web/src/types/game.ts`, `admin_web/src/api/coach.ts`(`requireGameClient` export)
- Create: `admin_web/src/api/featureFlags.ts`, `admin_web/src/pages/TradingGameSettings.tsx`
- Modify: `admin_web/src/components/Sidebar.tsx`, `admin_web/src/App.tsx`

- [ ] **Step 1: 타입 추가** (`types/game.ts` 끝)

```ts
// 기능 on/off (Phase 5b). 출처: game_dtos.FeatureFlagResponse
export type FeatureFlagKey = 'QUIZ' | 'STREAK'

export interface FeatureFlag {
  key: FeatureFlagKey
  enabled: boolean
  updated_at: string | null
}
```

- [ ] **Step 2: API**

`api/coach.ts`의 `function requireGameClient(): AxiosInstance {` → `export function requireGameClient(): AxiosInstance {`

`admin_web/src/api/featureFlags.ts`:

```ts
import { requireGameClient } from './coach'
import type { FeatureFlag, FeatureFlagKey } from '../types/game'

// 기능 on/off 관리자 API (trading_game, Phase 5b)
export const listFeatureFlags = async (): Promise<FeatureFlag[]> => {
  const { data } = await requireGameClient().get<FeatureFlag[]>('/api/game/admin/feature-flags')
  return data
}

export const updateFeatureFlag = async (key: FeatureFlagKey, enabled: boolean): Promise<FeatureFlag> => {
  const { data } = await requireGameClient().put<FeatureFlag>(`/api/game/admin/feature-flags/${key}`, { enabled })
  return data
}
```

- [ ] **Step 3: 페이지**

`admin_web/src/pages/TradingGameSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { AxiosError } from 'axios'
import { GAME_API_URL } from '../config'
import { listFeatureFlags, updateFeatureFlag } from '../api/featureFlags'
import { showToast } from '../lib/toast'
import type { FeatureFlag, FeatureFlagKey } from '../types/game'

const FLAG_META: Record<FeatureFlagKey, { title: string; description: string }> = {
  QUIZ: {
    title: '🌙 야간 차트 퀴즈',
    description: '끄면 유저 퀴즈 API가 "현재 운영하지 않음"을 응답합니다. 서버 재시작 없이 바로 반영됩니다.',
  },
  STREAK: {
    title: '🔥 연속 출석(Streak)',
    description: '끄면 매매·퀴즈를 해도 연속 출석 일수가 갱신되지 않습니다. 기존 기록은 보존됩니다.',
  },
}

const errorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return '게임 서버에 연결할 수 없습니다.'
}

const formatTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '변경 이력 없음'

function SettingsPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<FeatureFlagKey | null>(null)

  useEffect(() => {
    listFeatureFlags()
      .then(setFlags)
      .catch((e: unknown) => showToast(errorMessage(e), { icon: '⚠️' }))
      .finally(() => setLoading(false))
  }, [])

  const toggle = async (flag: FeatureFlag) => {
    const next = !flag.enabled
    setPending(flag.key)
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: next } : f)))
    try {
      const saved = await updateFeatureFlag(flag.key, next)
      setFlags((prev) => prev.map((f) => (f.key === saved.key ? saved : f)))
      showToast(`${FLAG_META[flag.key].title} ${next ? '켜짐' : '꺼짐'}`, { icon: next ? '✅' : '⏸️' })
    } catch (e) {
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? flag : f))) // 원상복구
      showToast(errorMessage(e), { icon: '⚠️' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-slate-900">기능 설정</h2>
      {loading ? (
        <p className="text-sm text-slate-400">불러오는 중…</p>
      ) : (
        <ul className="space-y-3">
          {flags.map((flag) => (
            <li
              key={flag.key}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <div>
                <p className="font-medium text-slate-900">{FLAG_META[flag.key].title}</p>
                <p className="mt-1 text-sm text-slate-500">{FLAG_META[flag.key].description}</p>
                <p className="mt-1 text-xs text-slate-400">마지막 변경: {formatTime(flag.updated_at)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                aria-label={FLAG_META[flag.key].title}
                disabled={pending !== null}
                onClick={() => toggle(flag)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                  flag.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                    flag.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TradingGameSettings() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">기능 설정</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">
            VITE_GAME_API_URL 을 설정해 빌드하면 기능 설정을 사용할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }
  return <SettingsPanel />
}
```

- [ ] **Step 4: 사이드바·라우트**

`Sidebar.tsx`: `items: [{ to: '/game/coach', label: '데일리 코치', icon: '📣' }],` →

```tsx
    items: [
      { to: '/game/coach', label: '데일리 코치', icon: '📣' },
      { to: '/game/settings', label: '기능 설정', icon: '⚙️' },
    ],
```

`App.tsx`: `import TradingGameCoach from './pages/TradingGameCoach'` 다음 줄에 `import TradingGameSettings from './pages/TradingGameSettings'`, `<Route path="game/coach" element={<TradingGameCoach />} />` 다음 줄에 `<Route path="game/settings" element={<TradingGameSettings />} />`.

- [ ] **Step 5: 타입체크·빌드**

```bash
cd admin_web
npx tsc --noEmit
VITE_API_BASE_URL=https://x.invalid VITE_AUTH_BASE_URL=https://x.invalid VITE_STOCK_API_URL=https://x.invalid npm run build
grep -l "localhost:8003" dist/assets/*.js || echo "no localhost:8003 in bundle"
```
Expected: 오류 없음, 빌드 성공, `no localhost:8003 in bundle`. (`VITE_*` 3개는 vite.config.js의 의도된 fail-fast 때문에 더미 값이 필요하다.)

- [ ] **Step 6: 커밋**

```bash
git add admin_web/src/types/game.ts admin_web/src/api/coach.ts admin_web/src/api/featureFlags.ts admin_web/src/pages/TradingGameSettings.tsx admin_web/src/components/Sidebar.tsx admin_web/src/App.tsx
git commit -m "feat(admin): 트레이딩 게임 기능 설정 화면 — 야간 퀴즈·연속 출석 토글

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 12: 문서 + 최종 검증

**Files:**
- Modify: `README.md` (trading_game 섹션), `docs/ROADMAP.md`

- [ ] **Step 1: README** — trading_game 섹션의 Phase 5a 설명 다음에 같은 형식(불릿/표)으로 추가:
  - **Phase 5b API**: `GET /api/game/quests`, `POST /api/game/quests/{code}/claim`, `GET /api/game/academy/quiz`, `POST /api/game/academy/submit`, `GET /api/game/quiz/random`, `POST /api/game/quiz/{id}/submit`, `GET /api/game/streak/my`, 관리자 `GET /api/game/admin/feature-flags`, `PUT /api/game/admin/feature-flags/{key}`.
  - **5배 레버리지 잠금**: 아카데미 3문항 통과 전 5배 주문은 403 `LEVERAGE_LOCKED`.
  - **보상과 랭킹**: 보상은 원금 조정분(`bonus_cash`)을 `b/(1+ROI)`만큼 함께 늘려 지급 직후 ROI 불변.
  - **기능 플래그**: QUIZ·STREAK, admin_web "트레이딩 게임 > ⚙️ 기능 설정", Redis 30초 캐시(변경 시 즉시 무효화).
  - **퀴즈 생성**: `cd backend && uv run python -m scripts.generate_chart_quiz --count 50 [--seed N]` — 로컬/개발 DB 전용, 재실행 멱등.

- [ ] **Step 2: ROADMAP** — `- [ ] **서브페이즈 5b** — ...` 줄을 `- [x]`로 바꾸고 끝에 ` (2026-10-12 완료: 퀘스트 Q1·Q2·Q3', 아카데미 5배 잠금, 야간 퀴즈·자동 생성, Streak, 기능 플래그)`를 붙인다. 백로그에 `- [ ] 퀴즈 생성 정기 스케줄(Celery beat)`, `- [ ] 연속 출석 보상·퀴즈/아카데미 문항 어드민 편집`을 추가한다(이미 있으면 생략).

- [ ] **Step 3: 전체 검증**

```bash
cd backend && uv run pytest -q 2>&1 | tail -5
cd ../admin_web && npx tsc --noEmit
```
Expected: 백엔드 F/E 없음(기존 150 + 5b 신규 전부), tsc 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP 현행화 — 트레이딩 게임 Phase 5b(퀘스트·아카데미·퀴즈·Streak)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

## 스펙 대비 자체 점검

| 스펙 항목 | 태스크 |
|---|---|
| §1 스키마·플래그 시드·마이그레이션 검증 | 1 |
| §2 원금(펀드 입금 방식)·ROI 분모 2곳 | 2 |
| §3 퀘스트 API | 6 |
| §3 아카데미 API·5배 잠금 | 7 |
| §3 퀴즈 random/submit(10+3초, 3회/일) | 9 |
| §3 streak/my | 4 |
| §4 기능 플래그 API·캐시·admin_web | 3, 11 |
| §5 주문 훅(Q1·Q2·Q3'·Streak), 퀴즈 Streak | 6, 8, 9 |
| §6 생성 스크립트 | 10 |
| §7 오류 코드 | 3, 6, 7, 9 |
| §8 테스트·회귀(5a 2건 수정)·훅 순서 | 전 태스크, 7, 8 |
| §9 문서 | 12 |

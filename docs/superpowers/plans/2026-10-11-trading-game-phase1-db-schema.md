# 트레이딩 게임 Phase 1 — DB 스키마 토대 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트레이딩 게임의 핵심 6테이블(시즌/계좌/포지션/거래/명예의전당/코치)을 SQLAlchemy로 정의하고 Alembic 마이그레이션·멱등 시드·pytest 테스트까지 완성한다.

**Architecture:** 게임 모델은 여러 미래 서비스(게임 API·수집 데몬·admin)가 공유하므로 `backend/shared/game_models.py`에 두고 `shared/models.py`가 import해 `Base.metadata`에 등록(Alembic 자동 감지)한다. `users.id`가 Integer이므로 유저 참조 FK는 Integer, 게임 내부 PK는 UUID를 쓰되, 테스트(aiosqlite)와 운영(PostgreSQL)에서 모두 동작하도록 DB 중립 `GUID` TypeDecorator로 감싼다.

**Tech Stack:** Python 3.12 · SQLAlchemy 2 (async) · Alembic · PostgreSQL(운영) / aiosqlite(테스트) · pytest-asyncio · uv

**Spec:** `docs/superpowers/specs/2026-10-11-trading-game-phase1-db-schema-design.md`

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `backend/shared/game_models.py` | GUID 타입 + 게임 6모델 정의 | Create (Task 1) |
| `backend/tests/test_game_models.py` | 모델/제약 검증(aiosqlite) | Create (Task 1) |
| `backend/alembic/env.py` | 게임 모델 import로 Alembic metadata 등록 | Modify (Task 2) |
| `backend/alembic/versions/<auto>.py` | 6테이블 생성 마이그레이션 | Create via autogenerate (Task 2) |

**설계 노트(순환 import 회피):** `game_models.py`는 `shared.models`에서 `Base`/`TimestampMixin`을 **단방향**으로만 import한다. `models.py`가 다시 `game_models`를 import하면, `game_models`를 먼저 로드하는 코드(시드 등)에서 "partially initialized module" 에러가 난다. 따라서 **`models.py`는 수정하지 않고**, Alembic이 게임 테이블을 감지하도록 `alembic/env.py`에서 `import shared.game_models` 한 줄만 추가한다. (모델은 `Base` 서브클래스 정의 시점에 `Base.metadata`에 자동 등록되므로, import만 되면 감지된다. 테스트·시드는 `shared.game_models`를 직접 import하므로 각자 등록됨.)
| `backend/scripts/__init__.py` | scripts 패키지 선언 | Create (Task 3) |
| `backend/scripts/seed_trading_game.py` | 시즌1기+코치 멱등 시드 | Create (Task 3) |

**중요(모든 Task 공통):**
- `git add -A` **금지**. 각 Task에 명시된 정확한 경로만 add. (리포에 추적 대상 아닌 `.claude/`·수정된 `.serena/project.yml`이 있으니 절대 전체 add하지 말 것.)
- 커밋 메시지 末尾에 항상 아래 2줄 부착:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 백엔드 작업은 `backend/` 디렉토리에서 `uv run ...`으로 실행.

---

## Task 1: 게임 모델 정의 + 등록 + 모델 테스트

**Files:**
- Create: `backend/shared/game_models.py`
- Modify: `backend/shared/models.py` (파일 맨 끝에 import 추가)
- Test: `backend/tests/test_game_models.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_game_models.py`

```python
"""트레이딩 게임 핵심 모델/제약 검증.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다
(기존 tests/test_blog_featured.py 패턴). sqlite의 FK 강제는 기본 꺼져 있어
connect 시 PRAGMA foreign_keys=ON 으로 켠다. UUID 는 GUID TypeDecorator 가
sqlite 에선 CHAR(32) 로 동작하므로 create_all 이 정상 수행된다.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameSeason, GameAccount, GamePosition


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _make_user(session, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=UserRole.FREE, is_active=True)
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


async def _make_season(session, end_at=None, number: int = 1) -> GameSeason:
    s = GameSeason(
        season_number=number,
        ticker="005930",
        stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
        end_at=end_at,
        status="ACTIVE",
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def test_season_open_ended_allows_null_end(session):
    s = await _make_season(session, end_at=None)
    assert s.id is not None
    assert s.end_at is None  # 무기한/미정 시즌


async def test_account_unique_per_user_season(session):
    u = await _make_user(session)
    s = await _make_season(session)
    session.add(GameAccount(user_id=u.id, season_id=s.id))
    await session.commit()
    session.add(GameAccount(user_id=u.id, season_id=s.id))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_position_open_links_account(session):
    u = await _make_user(session)
    s = await _make_season(session)
    acc = GameAccount(user_id=u.id, season_id=s.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    pos = GamePosition(
        account_id=acc.id, side="LONG", entry_price=71000,
        size_amount=1000000, leverage=2,
    )
    session.add(pos)
    await session.commit()
    await session.refresh(pos)
    assert isinstance(pos.id, uuid.UUID)
    assert pos.status == "OPEN"  # default


async def test_account_fk_rejects_missing_user(session):
    s = await _make_season(session)
    session.add(GameAccount(user_id=999999, season_id=s.id))
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && uv run pytest tests/test_game_models.py -q`
Expected: 수집 단계에서 `ModuleNotFoundError: No module named 'shared.game_models'` (또는 import 에러)로 실패.

- [ ] **Step 3: 모델 파일 작성** — `backend/shared/game_models.py`

```python
"""트레이딩 게임 PostgreSQL ORM 모델 (핵심 6테이블).

Phase 1 범위: 시즌/계좌/포지션/거래/명예의전당/코치메시지.
교육·소셜 테이블(chart_quiz_pool, user_streaks, private_leagues)은 추후 Phase.

users.id 가 Integer 이므로 유저 참조 FK(user_id/author_id)는 Integer,
게임 내부 PK(계좌/포지션/거래)는 UUID 를 쓴다. UUID 는 PostgreSQL 에선 네이티브
UUID, 그 외(테스트용 sqlite)에선 CHAR(32) 로 동작하도록 GUID 로 감싼다.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import CHAR, TypeDecorator

from shared.models import Base, TimestampMixin


class GUID(TypeDecorator):
    """DB 중립 UUID. PostgreSQL=native UUID, 그 외(sqlite)=CHAR(32) hex."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(32))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        if dialect.name == "postgresql":
            return value
        return value.hex

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(value)


class GameSeason(Base, TimestampMixin):
    """시즌 마스터. 종목 1개 고정. end_at NULL=무기한/미정."""

    __tablename__ = "game_seasons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    stock_name: Mapped[str] = mapped_column(String(50), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    initial_cash: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=10000000)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="READY")

    accounts: Mapped[list["GameAccount"]] = relationship(back_populates="season")


class GameAccount(Base, TimestampMixin):
    """유저 시즌별 가상 계좌. (user_id, season_id) 유일."""

    __tablename__ = "game_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "season_id", name="uq_user_season_account"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    cash_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=10000000)
    total_asset: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=10000000)
    current_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=0)
    max_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=0)
    total_trades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_trades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    season: Mapped["GameSeason"] = relationship(back_populates="accounts")
    positions: Mapped[list["GamePosition"]] = relationship(back_populates="account")
    trades: Mapped[list["GameTrade"]] = relationship(back_populates="account")


class GamePosition(Base, TimestampMixin):
    """활성 포지션. LONG/SHORT·레버리지·TP/SL."""

    __tablename__ = "game_positions"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("game_accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    side: Mapped[str] = mapped_column(String(10), nullable=False)  # 'LONG'/'SHORT'
    entry_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    size_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    leverage: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    stop_loss_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    take_profit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")

    account: Mapped["GameAccount"] = relationship(back_populates="positions")


class GameTrade(Base):
    """청산 완료 내역. TimestampMixin 미사용(closed_at 단일 시각)."""

    __tablename__ = "game_trades"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("game_accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    side: Mapped[str] = mapped_column(String(10), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    exit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    pnl_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    roi_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    closed_reason: Mapped[str] = mapped_column(String(20), nullable=False)
    closed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    account: Mapped["GameAccount"] = relationship(back_populates="trades")


class HallOfFame(Base):
    """시즌 최종 1~100위 박제."""

    __tablename__ = "hall_of_fame"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    final_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    final_asset: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    win_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    trading_mbti: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GameCoachMessage(Base):
    """관리자 스마트 코치 브리핑(모닝/이브닝/인플레이) + 지지/저항선."""

    __tablename__ = "game_coach_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    target_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    coach_type: Mapped[str] = mapped_column(String(20), nullable=False)  # MORNING/EVENING/IN_PLAY
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    summary_nudge: Mapped[str] = mapped_column(String(200), nullable=False)
    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    support_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    resistance_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    author_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && uv run pytest tests/test_game_models.py -q`
Expected: 4 passed.
(테스트는 `shared.game_models`를 직접 import하므로 `models.py` 수정 없이도 동작한다. Alembic 등록은 Task 2에서 `env.py`로 처리.)

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run: `cd backend && uv run pytest -q`
Expected: 기존 테스트 전부 + 신규 4개 통과(실패 0). (ClickHouse/KIS 연결이 필요한 테스트가 환경상 skip/xfail될 수 있으나 신규 실패는 없어야 함.)

- [ ] **Step 6: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/shared/game_models.py backend/tests/test_game_models.py
git commit -m "$(cat <<'EOF'
feat(game): 트레이딩 게임 핵심 6모델 정의 + 모델 테스트

game_seasons/accounts/positions/trades/hall_of_fame/coach_messages.
유저 FK는 users.id(Integer)에 맞추고 게임 내부 PK는 GUID(PG UUID/sqlite CHAR32).
시즌 end_at nullable(무기한)·period_type 라벨. aiosqlite 기반 모델/제약 테스트.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 2: Alembic 마이그레이션 생성·검토·적용

**Files:**
- Modify: `backend/alembic/env.py` (게임 모델 import 추가)
- Create: `backend/alembic/versions/<autogenerated>_create_trading_game_core_tables.py` (autogenerate 산출)

**사전 조건:** 로컬 PostgreSQL(:5432) 가동 중. Alembic은 `SYNC_DATABASE_URL`(psycopg2) env를 사용(우선순위 `ALEMBIC_DATABASE_URL` > `SYNC_DATABASE_URL` > 로컬 기본값).

- [ ] **Step 1: Alembic이 게임 모델을 감지하도록 등록** — `backend/alembic/env.py`의 `from shared.models import Base` 줄 **바로 아래**에 추가

```python
import shared.game_models  # noqa: F401  (게임 테이블을 Base.metadata 에 등록)
```
확인: `grep -n "import shared.game_models" alembic/env.py` 로 1줄 존재 확인.

- [ ] **Step 2: 현재 head가 적용돼 있는지 확인**

```bash
cd backend
export SYNC_DATABASE_URL="postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db"
uv run alembic current
```
Expected: 최신 기존 리비전이 (head)로 표시(없으면 `uv run alembic upgrade head` 먼저 실행).

- [ ] **Step 3: 마이그레이션 자동 생성**

```bash
cd backend
export SYNC_DATABASE_URL="postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db"
uv run alembic revision --autogenerate -m "create_trading_game_core_tables"
```
Expected: `alembic/versions/<hash>_create_trading_game_core_tables.py` 생성.

- [ ] **Step 4: 생성된 마이그레이션 수동 검토 (회귀 방지 — 필수)**

생성된 파일을 열어 아래를 확인:
- `upgrade()`에 **정확히 6개** `op.create_table(...)`: `game_seasons`, `game_accounts`, `game_positions`, `game_trades`, `hall_of_fame`, `game_coach_messages`.
- `game_accounts`에 `UniqueConstraint`('user_id','season_id', name='uq_user_season_account') 포함.
- 유저 참조 FK(`game_accounts.user_id`, `hall_of_fame.user_id`, `game_coach_messages.author_id`)의 컬럼 타입이 **INTEGER**이고 `users.id`를 참조.
- UUID PK 컬럼 타입이 `postgresql.UUID` 로 렌더됨(게임 내부 PK/ FK).
- **기존 테이블(users/boards/blog_posts/blog_comments 등)에 대한 `drop_table`/`alter_column`/`drop_column`이 전혀 없어야 함.** 있으면 모델 import 누락 또는 타입 불일치이므로, 그 파일을 삭제(`git clean`/수동)하고 원인 수정 후 Step 2 재수행.
- `downgrade()`에 6개 `op.drop_table(...)`이 역순으로 존재.

- [ ] **Step 5: 마이그레이션 적용**

```bash
cd backend
export SYNC_DATABASE_URL="postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db"
uv run alembic upgrade head
```
Expected: `Running upgrade … -> <hash>, create_trading_game_core_tables` 출력, 에러 없음.

- [ ] **Step 6: 다운그레이드/업그레이드 왕복 검증(안전성)**

```bash
cd backend
export SYNC_DATABASE_URL="postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db"
uv run alembic downgrade -1 && uv run alembic upgrade head
```
Expected: downgrade로 6테이블 drop → upgrade로 재생성, 모두 에러 없음.

- [ ] **Step 7: 테이블 생성 확인**

```bash
cd backend
export SYNC_DATABASE_URL="postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_db"
uv run python -c "import os;from sqlalchemy import create_engine,inspect;e=create_engine(os.environ['SYNC_DATABASE_URL']);print([t for t in inspect(e).get_table_names() if t.startswith('game_') or t=='hall_of_fame'])"
```
Expected: `['game_accounts', 'game_coach_messages', 'game_positions', 'game_seasons', 'game_trades', 'hall_of_fame']` (순서 무관).

- [ ] **Step 8: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/alembic/env.py backend/alembic/versions/*create_trading_game_core_tables*.py
git commit -m "$(cat <<'EOF'
feat(game): 트레이딩 게임 핵심 6테이블 Alembic 마이그레이션

game_seasons/accounts/positions/trades/hall_of_fame/coach_messages 생성.
유저 FK=Integer(users.id), 게임 PK=UUID. 기존 테이블 변경 없음(검토 완료).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## Task 3: 개발 시드 스크립트

**Files:**
- Create: `backend/scripts/__init__.py`
- Create: `backend/scripts/seed_trading_game.py`

- [ ] **Step 1: scripts 패키지 선언** — `backend/scripts/__init__.py` (빈 파일)

```python
```

- [ ] **Step 2: 시드 스크립트 작성** — `backend/scripts/seed_trading_game.py`

```python
"""트레이딩 게임 개발 시드 (멱등).

시즌 1기(005930 삼성전자, 당월 1일 09:00 시작, end_at=NULL 무기한) +
샘플 모닝 코치 메시지 1건. 재실행 시 season_number=1 존재하면 시즌은 건너뛰고,
같은 시즌+오늘+MORNING 코치가 있으면 코치도 건너뛴다.

실행:
    cd backend
    uv run python -m scripts.seed_trading_game

주의: 운영 DB에는 실행하지 말 것. 로컬(stock_db)에서만 사용한다.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameCoachMessage, GameSeason


def _month_start_09() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, 9, 0, tzinfo=timezone.utc)


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        season = (
            await db.execute(select(GameSeason).where(GameSeason.season_number == 1))
        ).scalar_one_or_none()
        created_season = False
        if season is None:
            season = GameSeason(
                season_number=1,
                ticker="005930",
                stock_name="삼성전자",
                start_at=_month_start_09(),
                end_at=None,          # 기간 미정/무기한
                period_type=None,
                status="ACTIVE",
            )
            db.add(season)
            await db.flush()          # season.id 확보
            created_season = True

        today = date.today()
        exists = (
            await db.execute(
                select(GameCoachMessage).where(
                    GameCoachMessage.season_id == season.id,
                    GameCoachMessage.target_date == today,
                    GameCoachMessage.coach_type == "MORNING",
                )
            )
        ).scalar_one_or_none()
        created_coach = False
        if exists is None:
            db.add(
                GameCoachMessage(
                    season_id=season.id,
                    target_date=today,
                    coach_type="MORNING",
                    title="오늘의 모닝 브리핑",
                    summary_nudge="71,000원 지지선 반등 여부를 주목하세요!",
                    content_md=(
                        "## 오늘의 전략\n"
                        "71,000원 지지선과 73,500원 저항선 사이 흐름을 주시합니다."
                    ),
                    support_price=71000,
                    resistance_price=73500,
                    author_id=None,
                )
            )
            created_coach = True

        await db.commit()
        print(
            f"[seed_trading_game] season(created={created_season}, number=1), "
            f"coach(created={created_coach})"
        )


if __name__ == "__main__":
    asyncio.run(seed())
```

- [ ] **Step 3: 시드 실행**

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db"
uv run python -m scripts.seed_trading_game
```
Expected: `[seed_trading_game] season(created=True, number=1), coach(created=True)`

- [ ] **Step 4: 멱등 확인(재실행)**

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db"
uv run python -m scripts.seed_trading_game
```
Expected: `[seed_trading_game] season(created=False, number=1), coach(created=False)` (중복 생성 없음)

- [ ] **Step 5: 적재 확인**

```bash
cd backend
export DATABASE_URL="postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_db"
uv run python -c "
import asyncio
from sqlalchemy import select, func
from shared.database import AsyncSessionLocal
from shared.game_models import GameSeason, GameCoachMessage
async def main():
    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(GameSeason).where(GameSeason.season_number==1))).scalar_one()
        c = (await db.execute(select(func.count()).select_from(GameCoachMessage).where(GameCoachMessage.season_id==s.id))).scalar_one()
        print(f'season#{s.season_number} {s.stock_name}({s.ticker}) status={s.status} end_at={s.end_at} coach_msgs={c}')
asyncio.run(main())
"
```
Expected: `season#1 삼성전자(005930) status=ACTIVE end_at=None coach_msgs=1`

- [ ] **Step 6: 커밋**

```bash
cd /Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app
git add backend/scripts/__init__.py backend/scripts/seed_trading_game.py
git commit -m "$(cat <<'EOF'
feat(game): 트레이딩 게임 개발 시드(시즌1기+모닝 코치) 멱등 스크립트

005930 삼성전자 시즌1기(end_at=NULL 무기한, ACTIVE) + 샘플 모닝 코치 1건.
재실행 멱등(시즌/코치 중복 생성 안 함).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
EOF
)"
```

---

## 완료 기준 (전체)
- [ ] Task 1~3 전부 완료, 각 커밋 생성
- [ ] `uv run pytest tests/test_game_models.py -q` 4 passed
- [ ] `uv run pytest -q` 신규 실패 0(회귀 없음)
- [ ] 마이그레이션이 기존 테이블 변경 없이 6테이블만 생성
- [ ] 시드 멱등 동작, 시즌1기 ACTIVE·end_at NULL 확인
- [ ] 추후 Phase(교육/소셜 3테이블, 서비스 배치)는 스펙에 기록된 대로 미착수 유지

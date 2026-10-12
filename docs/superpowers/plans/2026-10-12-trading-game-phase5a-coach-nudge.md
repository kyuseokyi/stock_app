# 트레이딩 게임 Phase 5a(데일리 코치 + 스마트 넛지) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 admin_web에서 모닝/이브닝 시황(지지·저항선 포함)을 초안 저장하고 실시간 발행할 수 있게 한다. 게임 주문·청산 시에는 규칙 기반 교육 넛지(경고/칭찬/조언)를 REST 응답과 WS로 전달한다.

**Architecture:** trading_game(8003)에 코치 라우터·서비스와 순수 넛지 엔진, Wilder RSI 서비스를 추가한다. 주문 라우터와 틱 리스너에는 넛지를 best-effort로 붙인다. 넛지 실패가 체결이나 청산을 깨면 안 된다. admin_web(strict TS)에는 선택적 게임 API 클라이언트와 코치 페이지를 추가한다.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, Redis(fakeredis 테스트), ClickHouse(`get_candles` 재사용), pytest-asyncio, httpx ASGITransport / React 18 + TS strict + Tailwind, marked, dompurify

**Spec:** `docs/superpowers/specs/2026-10-12-trading-game-phase5a-coach-nudge-design.md`

---

## 공통 규칙 (모든 태스크)

1. 작업 디렉터리: 저장소 루트 `/Users/kyuseok/Documents/private/projects/ivyro/work_space/stock_app`, 브랜치 `dev`.
2. 백엔드 명령은 `cd backend && uv run ...`으로 실행한다. pytest는 `asyncio_mode=auto`라서 `@pytest.mark.asyncio`가 필요 없다. 테스트는 aiosqlite 인메모리와 `Base.metadata.create_all`을 쓴다(alembic을 쓰지 않는다).
3. **커밋은 명시 경로만 add한다.** `git add -A`와 `git add .`는 금지다(`.claude/`와 `.serena/project.yml`은 커밋하면 안 된다). 커밋 메시지 끝에 다음 두 줄을 그대로 붙인다.
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
   ```
4. KIS 자격증명(`backend/.env.development`)은 출력하거나 커밋하지 않는다. DB 마이그레이션 검증은 **일회용 로컬 docker PG**에서만 한다(dev 터널 15432는 건드리지 않는다).
5. admin_web은 strict TS다. 명시적 `any`·`@ts-ignore`는 금지다. `as`는 axios/JSON/외부 라이브러리 경계에서만 쓴다. 폼 밖이든 안이든 **모든 비-submit `<button>`에 `type="button"`** 을 붙인다.
6. admin_web 검증은 `cd admin_web && npx tsc --noEmit && VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x VITE_STOCK_API_URL=http://x npm run build`로 한다.
7. 백엔드 전체 회귀: `cd backend && uv run pytest -q`. 시작 시점 기준 101 passed이고, 이 수가 줄면 안 된다.
8. GateGuard 훅이 Write/Edit를 막으면, 대상에 `ls`나 `grep`을 한 번 실행하고 "대체 대상 / 참조 위치 / 사용자 지시: Phase 5a 플랜 실행"을 진술한 뒤 재시도한다.

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `backend/shared/game_models.py` | `GameCoachMessage.status` 추가, `published_at` nullable | 1 |
| `backend/alembic/versions/c3d4e5f6a7b8_coach_draft_status.py` | 위 스키마 마이그레이션 | 1 |
| `backend/apps/trading_game/services/nudge_engine.py` | 순수 넛지 규칙 | 2 |
| `backend/apps/trading_game/services/rsi_service.py` | Wilder RSI + 종가 캐시 | 3 |
| `backend/apps/trading_game/schemas/game_dtos.py` | 코치·시즌·넛지 DTO | 4, 6 |
| `backend/apps/trading_game/services/coach_service.py` | 코치 upsert/조회/푸시 페이로드 | 4 |
| `backend/apps/trading_game/routers/coach.py` + `main.py` | 코치·시즌 REST | 5 |
| `backend/apps/trading_game/routers/orders.py` | 주문·청산 응답에 넛지 | 6 |
| `backend/apps/trading_game/services/liquidation_service.py`, `tick_listener.py` | 자동 청산 넛지 WS | 7 |
| `backend/tests/test_coach_and_nudge.py` | 5a 테스트 전부 | 1~7 |
| `admin_web/package.json`·lock, `src/vite-env.d.ts`, `src/config.ts`, `src/api/client.ts`, `src/api/coach.ts`, `src/types/game.ts` | 게임 API 기반 | 8 |
| `admin_web/src/pages/TradingGameCoach.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx` | 코치 화면 | 9 |
| `README.md`, `docs/ROADMAP.md` | 문서 | 10 |

---

### Task 1: 코치 초안 상태 — 모델 + 마이그레이션

**Files:**
- Modify: `backend/shared/game_models.py` (`GameCoachMessage`)
- Create: `backend/alembic/versions/c3d4e5f6a7b8_coach_draft_status.py`
- Create: `backend/tests/test_coach_and_nudge.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_coach_and_nudge.py`를 새로 만든다. 이 파일은 이후 태스크에서 계속 이어 붙인다.

```python
"""트레이딩 게임 Phase 5a — 데일리 코치 + 스마트 넛지 테스트."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameCoachMessage, GameSeason


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


async def _seed_season(db, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def test_coach_message_draft_has_null_published_at(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="MORNING",
        title="t", summary_nudge="s", content_md="c", status="DRAFT", published_at=None,
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "DRAFT"
    assert msg.published_at is None


async def test_coach_message_status_defaults_to_published(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="EVENING",
        title="t", summary_nudge="s", content_md="c",
        published_at=datetime(2026, 10, 13, 11, 0, tzinfo=timezone.utc),
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "PUBLISHED"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v`
Expected: FAIL. `status`라는 키워드 인자가 없어 TypeError가 나거나, `published_at` NOT NULL 제약에 걸린다.

- [ ] **Step 3: 모델 수정.** `backend/shared/game_models.py`의 `GameCoachMessage`에서 `published_at` 정의를 아래로 바꾸고, 그 바로 위에 `status`를 추가한다.

```python
    # DRAFT(임시저장) | PUBLISHED(발행). 기존 행 호환을 위해 서버 기본값 PUBLISHED.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="PUBLISHED", server_default="PUBLISHED"
    )
    # 발행 시각 — PUBLISHED 로 전환될 때 서비스가 기록. 초안은 NULL.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```
docstring에 "(Phase 5a: status 로 초안/발행 구분)"을 덧붙인다. 다른 필드는 바꾸지 않는다.

- [ ] **Step 4: 마이그레이션 작성** `backend/alembic/versions/c3d4e5f6a7b8_coach_draft_status.py`

```python
"""game_coach_messages: draft status + nullable published_at (Phase 5a)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "game_coach_messages",
        sa.Column("status", sa.String(20), nullable=False, server_default="PUBLISHED"),
    )
    op.alter_column(
        "game_coach_messages", "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
        server_default=None,
        existing_server_default=sa.text("now()"),
    )


def downgrade() -> None:
    op.execute("UPDATE game_coach_messages SET published_at = now() WHERE published_at IS NULL")
    op.alter_column(
        "game_coach_messages", "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    op.drop_column("game_coach_messages", "status")
```

- [ ] **Step 5: 테스트 통과 + 전체 회귀**

Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v && uv run pytest -q`
Expected: 새 테스트 2개 PASS. 전체는 103 passed. `tests/test_game_models.py`의 기존 코치 테스트는 `published_at`을 넘기지 않는다. 이제 nullable이므로 통과해야 한다. 만약 `published_at`이 채워졌다고 단정하는 기존 테스트가 있다면, 그 테스트에서 `published_at`을 명시적으로 넘기도록 **테스트만** 수정한다.

- [ ] **Step 6: 일회용 PG에서 마이그레이션 검증**

```bash
docker exec stock_postgres createdb -U stock_user stock_p5a_check
cd backend
ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p5a_check uv run alembic upgrade head
ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p5a_check uv run alembic check
ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p5a_check uv run alembic downgrade -1
ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p5a_check uv run alembic upgrade head
docker exec stock_postgres dropdb -U stock_user stock_p5a_check
```
Expected: `alembic check` → "No new upgrade operations detected." downgrade와 재upgrade도 성공한다. 마지막에 일회용 DB를 삭제한다.

- [ ] **Step 7: 커밋**

```bash
git add backend/shared/game_models.py backend/alembic/versions/c3d4e5f6a7b8_coach_draft_status.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 코치 메시지 초안 상태(status) + published_at nullable 마이그레이션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 순수 넛지 규칙 엔진

**Files:**
- Create: `backend/apps/trading_game/services/nudge_engine.py`
- Test: `backend/tests/test_coach_and_nudge.py` (끝에 추가)

- [ ] **Step 1: 실패 테스트 추가** (파일 끝에 붙인다)

```python
# ---------------------------------------------------------------- nudge engine
from apps.trading_game.services import nudge_engine


def _codes(nudges):
    return [n.code for n in nudges]


@pytest.mark.parametrize("rsi, expected", [(79.99, []), (80.0, ["OVERBOUGHT_CHASE"]), (None, [])])
def test_open_overbought_threshold(rsi, expected):
    assert _codes(nudge_engine.nudges_for_open(side="LONG", ratio=0.25, leverage=1, rsi=rsi)) == expected


def test_open_short_never_overbought_warning():
    assert nudge_engine.nudges_for_open(side="SHORT", ratio=0.25, leverage=1, rsi=95.0) == []


@pytest.mark.parametrize("ratio, leverage, expected", [
    (1.0, 5, ["OVERLEVERAGE"]),
    (1.0, 2, []),
    (0.5, 5, []),
])
def test_open_overleverage(ratio, leverage, expected):
    assert _codes(nudge_engine.nudges_for_open(side="SHORT", ratio=ratio, leverage=leverage, rsi=None)) == expected


def test_open_warning_and_advice_together_in_order():
    nudges = nudge_engine.nudges_for_open(side="LONG", ratio=1.0, leverage=5, rsi=85.0)
    assert _codes(nudges) == ["OVERBOUGHT_CHASE", "OVERLEVERAGE"]
    assert [n.type for n in nudges] == ["WARNING", "ADVICE"]


@pytest.mark.parametrize("reason, roi, expected", [
    ("STOP_LOSS", Decimal("-0.99"), []),
    ("STOP_LOSS", Decimal("-1"), ["PRINCIPLED_STOP"]),
    ("MANUAL", Decimal("-2.5"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3.01"), []),
    ("TAKE_PROFIT", Decimal("-2"), []),
    ("MARGIN_CALL", Decimal("-2"), []),
])
def test_close_principled_stop(reason, roi, expected):
    assert _codes(nudge_engine.nudges_for_close(closed_reason=reason, roi_pct=roi)) == expected


def test_nudge_to_dict_shape():
    n = nudge_engine.nudges_for_close(closed_reason="MANUAL", roi_pct=Decimal("-2"))[0]
    assert n.to_dict() == {"type": "PRAISE", "code": "PRINCIPLED_STOP", "message": n.message}
    assert n.message.startswith("💡")
```

- [ ] **Step 2: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k "open or close or nudge" -v` → Expected: ImportError(`nudge_engine` 없음).

- [ ] **Step 3: 구현** `backend/apps/trading_game/services/nudge_engine.py`

```python
"""스마트 넛지 규칙 엔진 — I/O 없는 순수 함수 (Phase 5a).

주문 진입/청산 직후 사용자에게 보여 줄 교육용 말풍선을 결정한다.
판정 기준값은 스펙 §3.1 참조. roi_pct 는 GameTrade.roi_pct(레버리지·왕복수수료 반영 %, 화면 표시 ROI).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

NudgeType = Literal["WARNING", "PRAISE", "ADVICE"]

RSI_OVERBOUGHT = 80.0
PRAISE_ROI_MIN = Decimal("-3")
PRAISE_ROI_MAX = Decimal("-1")
_PRAISE_REASONS = frozenset({"STOP_LOSS", "MANUAL"})


@dataclass(frozen=True)
class Nudge:
    type: NudgeType
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"type": self.type, "code": self.code, "message": self.message}


OVERBOUGHT_CHASE = Nudge(
    "WARNING", "OVERBOUGHT_CHASE", "⚠️ RSI 과열 구간입니다! 추격 매수는 물릴 위험이 높아요."
)
OVERLEVERAGE = Nudge(
    "ADVICE", "OVERLEVERAGE",
    "💬 과도한 레버리지는 급격한 마진콜을 유발할 수 있습니다. 분할 매수를 고려하세요.",
)
PRINCIPLED_STOP = Nudge(
    "PRAISE", "PRINCIPLED_STOP", "💡 원칙대로 손실을 잘 끊어냈습니다! 훌륭한 자금 관리 습관입니다."
)


def nudges_for_open(*, side: str, ratio: float, leverage: int, rsi: float | None) -> list[Nudge]:
    """진입 넛지. 순서: WARNING → ADVICE (둘 다 해당 가능)."""
    out: list[Nudge] = []
    if side == "LONG" and rsi is not None and rsi >= RSI_OVERBOUGHT:
        out.append(OVERBOUGHT_CHASE)
    if Decimal(str(ratio)) == Decimal("1") and leverage == 5:
        out.append(OVERLEVERAGE)
    return out


def nudges_for_close(*, closed_reason: str, roi_pct: Decimal | None) -> list[Nudge]:
    """청산 넛지. 손절(STOP_LOSS) 또는 수동청산(MANUAL) 이 ROI -3% ~ -1% 일 때만 칭찬."""
    if roi_pct is None or closed_reason not in _PRAISE_REASONS:
        return []
    roi = Decimal(str(roi_pct))
    if PRAISE_ROI_MIN <= roi <= PRAISE_ROI_MAX:
        return [PRINCIPLED_STOP]
    return []
```

- [ ] **Step 4: 통과 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v` → 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/nudge_engine.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 스마트 넛지 순수 규칙 엔진(과열 추격·과레버리지·원칙 손절)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: Wilder RSI 서비스 (종가 일일 캐시)

**Files:**
- Create: `backend/apps/trading_game/services/rsi_service.py`
- Test: `backend/tests/test_coach_and_nudge.py` (끝에 추가)

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- RSI
import json

from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import rsi_service

# StockCharts "RSI" 예제 종가. 시트는 중간값 반올림으로 70.53/66.32 를 표기하지만,
# 반올림 없는 Wilder 계산의 정밀값은 70.4641 / 66.2496 이다.
_SC_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
              45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]


def test_wilder_rsi_hand_computed_period2():
    # 변화 +1,+1 → 시드 gain 1 / loss 0; -1 → 0.5/0.5; +1 → 0.75/0.25 → RS 3 → 75
    assert rsi_service.wilder_rsi([1, 2, 3, 2, 3], period=2) == pytest.approx(75.0)


def test_wilder_rsi_stockcharts_vector():
    assert rsi_service.wilder_rsi(_SC_CLOSES) == pytest.approx(70.4641, abs=1e-3)
    assert rsi_service.wilder_rsi(_SC_CLOSES + [46.00]) == pytest.approx(66.2496, abs=1e-3)


def test_wilder_rsi_all_gains_is_100_and_short_input_none():
    assert rsi_service.wilder_rsi([float(i) for i in range(1, 17)]) == 100.0
    assert rsi_service.wilder_rsi([1.0] * 14) is None  # period+1 미만


async def test_current_rsi_caches_closes_per_day():
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    calls = []

    async def provider(ticker, today):
        calls.append((ticker, today))
        return _SC_CLOSES[:-1]  # 14개 + live 1개 = 15개

    today = date(2026, 10, 13)
    v1 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    v2 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    assert v1 == pytest.approx(70.4641, abs=1e-3)
    assert v2 == v1
    assert len(calls) == 1  # 두 번째는 캐시 적중
    cached = await redis.get("game:rsi:closes:005930:20261013")
    assert json.loads(cached) == _SC_CLOSES[:-1]
    assert await redis.ttl("game:rsi:closes:005930:20261013") > 0


async def test_current_rsi_returns_none_on_provider_error_and_does_not_cache_empty():
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def boom(ticker, today):
        raise RuntimeError("clickhouse down")

    async def empty(ticker, today):
        return []

    today = date(2026, 10, 13)
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=boom) is None
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=empty) is None
    assert await redis.get("game:rsi:closes:005930:20261013") is None


def test_fetch_closes_excludes_today(monkeypatch):
    from types import SimpleNamespace
    from apps.stock_api.services import clickhouse_source

    rows = [SimpleNamespace(date="2026-10-10", close=1.0),
            SimpleNamespace(date="2026-10-12", close=2.0),
            SimpleNamespace(date="2026-10-13", close=3.0)]  # 오늘 행은 제외되어야 함
    monkeypatch.setattr(clickhouse_source, "get_candles", lambda s, a, b: rows)
    assert rsi_service._fetch_closes_from_clickhouse("005930", date(2026, 10, 13)) == [1.0, 2.0]
```

- [ ] **Step 2: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k rsi -v` → ImportError.

- [ ] **Step 3: 구현** `backend/apps/trading_game/services/rsi_service.py`

```python
"""과열 판단용 Wilder RSI(14) — 일봉 종가(오늘 이전) + 실시간 현재가 (Phase 5a).

종가 배열은 하루 단위로 Redis 에 캐시해 주문마다 ClickHouse 를 치지 않는다.
모든 실패는 None(넛지 미발생)으로 흡수한다 — 주문 경로를 막지 않는 best-effort.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Awaitable, Callable, Sequence
from zoneinfo import ZoneInfo

log = logging.getLogger("trading_game.rsi")

KST = ZoneInfo("Asia/Seoul")
RSI_PERIOD = 14
CLOSES_LOOKBACK = 100          # Wilder 평활 수렴용 (MTS 값과 근사)
CALENDAR_SPAN_DAYS = 200       # 영업일 100개 이상 확보용 달력 구간
CACHE_TTL_SECONDS = 26 * 3600

ClosesProvider = Callable[[str, date], Awaitable[list[float]]]


def wilder_rsi(closes: Sequence[float], period: int = RSI_PERIOD) -> float | None:
    """Wilder RSI. 첫 period 개 변화량 단순평균으로 시드 → 이후 (prev*(p-1)+x)/p 평활."""
    if len(closes) < period + 1:
        return None
    changes = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    avg_gain = sum(max(c, 0.0) for c in changes[:period]) / period
    avg_loss = sum(max(-c, 0.0) for c in changes[:period]) / period
    for c in changes[period:]:
        avg_gain = (avg_gain * (period - 1) + max(c, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-c, 0.0)) / period
    if avg_loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _fetch_closes_from_clickhouse(ticker: str, today: date) -> list[float]:
    # 의도적 cross-app import(collector settle_season 과 동일 선례) — get_candles 가
    # stock_api GraphQL Candle 타입을 반환해 shared 로 옮기지 않는다. 지연 import 로 결합 최소화.
    from apps.stock_api.services import clickhouse_source

    start = (today - timedelta(days=CALENDAR_SPAN_DAYS)).isoformat()
    end = (today - timedelta(days=1)).isoformat()
    candles = clickhouse_source.get_candles(ticker, start, end) or []
    closes = [float(c.close) for c in candles if str(c.date)[:10] < today.isoformat()]
    return closes[-CLOSES_LOOKBACK:]


async def clickhouse_closes(ticker: str, today: date) -> list[float]:
    """동기 ClickHouse 조회를 스레드로 위임(이벤트 루프 블로킹 방지)."""
    return await asyncio.to_thread(_fetch_closes_from_clickhouse, ticker, today)


def _cache_key(ticker: str, today: date) -> str:
    return f"game:rsi:closes:{ticker}:{today:%Y%m%d}"


async def current_rsi(
    redis,
    ticker: str,
    live_price: Decimal,
    *,
    today: date | None = None,
    closes_provider: ClosesProvider = clickhouse_closes,
) -> float | None:
    """오늘 이전 종가(캐시) + live_price 로 RSI 계산. 실패·데이터 부족 시 None."""
    today = today or datetime.now(KST).date()
    key = _cache_key(ticker, today)
    try:
        raw = await redis.get(key)
        if raw is not None:
            closes = [float(x) for x in json.loads(raw)]
        else:
            closes = await closes_provider(ticker, today)
            if closes:  # 빈 결과는 캐시하지 않음(수집 지연 시 재시도)
                await redis.set(key, json.dumps(closes), ex=CACHE_TTL_SECONDS)
        return wilder_rsi([*closes, float(live_price)])
    except Exception:
        log.warning("RSI 계산 실패 ticker=%s — 넛지 생략", ticker, exc_info=True)
        return None
```

- [ ] **Step 4: 통과 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v` → 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/rsi_service.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): Wilder RSI(14) 서비스 — 일봉 종가 일일 캐시 + 현재가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 코치 DTO + 서비스

**Files:**
- Modify: `backend/apps/trading_game/schemas/game_dtos.py` (파일 끝에 추가)
- Create: `backend/apps/trading_game/services/coach_service.py`
- Test: `backend/tests/test_coach_and_nudge.py`

- [ ] **Step 1: DTO 추가** — `game_dtos.py` 맨 위 import에 `from datetime import date, datetime`과 `model_validator`(pydantic)가 포함되도록 한다(기존 import는 유지하고 빠진 것만 추가). 파일 끝에 다음을 추가한다.

```python
# ---------------------------------------------------------------- Phase 5a: coach
CoachType = Literal["MORNING", "EVENING"]  # 모델의 IN_PLAY 는 5a 범위 밖


class CoachUpsertRequest(BaseModel):
    season_id: int
    target_date: date
    coach_type: CoachType
    title: str = Field(min_length=1, max_length=100)
    summary_nudge: str = Field(min_length=1, max_length=200)
    support_price: Decimal | None = Field(default=None, gt=0)
    resistance_price: Decimal | None = Field(default=None, gt=0)
    content_md: str = Field(min_length=1)
    action: Literal["draft", "publish"]

    @model_validator(mode="after")
    def _support_below_resistance(self) -> "CoachUpsertRequest":
        if (
            self.support_price is not None
            and self.resistance_price is not None
            and self.support_price >= self.resistance_price
        ):
            raise ValueError("지지선은 저항선보다 낮아야 합니다.")
        return self


class CoachMessageResponse(BaseModel):
    id: int
    season_id: int
    target_date: date
    coach_type: str
    title: str
    summary_nudge: str
    content_md: str
    support_price: Decimal | None
    resistance_price: Decimal | None
    status: str
    published_at: datetime | None


class CoachTodayResponse(BaseModel):
    target_date: date
    season_id: int | None
    morning: CoachMessageResponse | None
    evening: CoachMessageResponse | None
    active: CoachMessageResponse | None


class SeasonOption(BaseModel):
    id: int
    season_number: int
    ticker: str
    stock_name: str
    status: str
    start_at: datetime
    end_at: datetime | None
```

- [ ] **Step 2: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- coach service
from pydantic import ValidationError

from apps.trading_game.schemas.game_dtos import CoachUpsertRequest
from apps.trading_game.services import coach_service


def _req(season_id, action="draft", **over):
    kw = dict(
        season_id=season_id, target_date=date(2026, 10, 13), coach_type="MORNING",
        title="모닝 브리핑", summary_nudge="반도체 강세 출발", content_md="## 시황\n- 외국인 순매수",
        support_price=Decimal("70000"), resistance_price=Decimal("75000"), action=action,
    )
    kw.update(over)
    return CoachUpsertRequest(**kw)


async def _seed_admin(db) -> User:
    u = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


def test_upsert_request_rejects_support_not_below_resistance():
    with pytest.raises(ValidationError):
        _req(1, support_price=Decimal("75000"), resistance_price=Decimal("75000"))


async def test_draft_then_publish_then_redraft_conflict(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)

    draft = await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    assert draft.status == "DRAFT" and draft.published_at is None

    pub = await coach_service.upsert_coach_message(
        session, req=_req(season.id, action="publish", title="수정 제목"), author_id=admin.id
    )
    assert pub.id == draft.id  # 같은 슬롯 → 덮어쓰기
    assert pub.status == "PUBLISHED" and pub.published_at is not None
    assert pub.title == "수정 제목"

    with pytest.raises(coach_service.CoachError) as ei:
        await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    assert ei.value.code == "ALREADY_PUBLISHED"


async def test_upsert_unknown_season(session):
    admin = await _seed_admin(session)
    with pytest.raises(coach_service.CoachError) as ei:
        await coach_service.upsert_coach_message(session, req=_req(999), author_id=admin.id)
    assert ei.value.code == "SEASON_NOT_FOUND"


async def test_today_coach_only_published_and_both_slots(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)
    today = date(2026, 10, 13)

    assert await coach_service.today_coach(session, today) == (season.id, None, None)

    await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)  # 초안
    assert await coach_service.today_coach(session, today) == (season.id, None, None)

    await coach_service.upsert_coach_message(session, req=_req(season.id, action="publish"), author_id=admin.id)
    _, morning, evening = await coach_service.today_coach(session, today)
    assert morning is not None and evening is None

    await coach_service.upsert_coach_message(
        session, req=_req(season.id, action="publish", coach_type="EVENING", title="이브닝"),
        author_id=admin.id,
    )
    _, morning, evening = await coach_service.today_coach(session, today)
    assert morning.coach_type == "MORNING" and evening.coach_type == "EVENING"


async def test_today_coach_without_active_season(session):
    await _seed_season(session, status="FINISHED")
    assert await coach_service.today_coach(session, date(2026, 10, 13)) == (None, None, None)


async def test_list_slot_messages_includes_drafts_and_push_payload(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)
    await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    rows = await coach_service.list_slot_messages(session, season.id, date(2026, 10, 13))
    assert [r.status for r in rows] == ["DRAFT"]

    payload = coach_service.coach_push_payload(rows[0])
    assert payload["type"] == "coach"
    assert payload["coach_type"] == "MORNING"
    assert payload["target_date"] == "2026-10-13"
    assert Decimal(payload["support_price"]) == Decimal("70000")
    assert Decimal(payload["resistance_price"]) == Decimal("75000")


def test_kst_today_is_date():
    assert isinstance(coach_service.kst_today(), date)
```

- [ ] **Step 3: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k "coach or upsert or today or slot or kst" -v` → ImportError(`coach_service`).

- [ ] **Step 4: 구현** `backend/apps/trading_game/services/coach_service.py`

```python
"""데일리 스마트 코치 서비스 — 슬롯 upsert(초안/발행), 오늘 코칭 조회 (Phase 5a).

슬롯 키 = (season_id, target_date, coach_type). 발행된 슬롯을 초안으로 되돌리는 것은 금지
(실수로 발행 취소 방지) — 발행본 수정은 다시 publish.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameCoachMessage, GameSeason
from apps.trading_game.schemas.game_dtos import CoachMessageResponse, CoachUpsertRequest
from apps.trading_game.services import account_service

KST = ZoneInfo("Asia/Seoul")


class CoachError(Exception):
    """code: SEASON_NOT_FOUND | ALREADY_PUBLISHED | SLOT_CONFLICT"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def kst_today() -> date:
    return datetime.now(KST).date()


async def _get_slot(db: AsyncSession, season_id: int, target_date: date, coach_type: str) -> GameCoachMessage | None:
    row = await db.execute(
        select(GameCoachMessage).where(
            GameCoachMessage.season_id == season_id,
            GameCoachMessage.target_date == target_date,
            GameCoachMessage.coach_type == coach_type,
        )
    )
    return row.scalar_one_or_none()


async def upsert_coach_message(
    db: AsyncSession, *, req: CoachUpsertRequest, author_id: int
) -> GameCoachMessage:
    if await db.get(GameSeason, req.season_id) is None:
        raise CoachError("SEASON_NOT_FOUND", "시즌을 찾을 수 없습니다.")

    msg = await _get_slot(db, req.season_id, req.target_date, req.coach_type)
    if msg is not None and msg.status == "PUBLISHED" and req.action == "draft":
        raise CoachError("ALREADY_PUBLISHED", "이미 발행된 브리핑입니다. 수정하려면 다시 발행하세요.")
    if msg is None:
        msg = GameCoachMessage(
            season_id=req.season_id, target_date=req.target_date, coach_type=req.coach_type,
        )
        db.add(msg)

    msg.title = req.title
    msg.summary_nudge = req.summary_nudge
    msg.content_md = req.content_md
    msg.support_price = req.support_price
    msg.resistance_price = req.resistance_price
    msg.author_id = author_id
    if req.action == "publish":
        msg.status = "PUBLISHED"
        msg.published_at = datetime.now(timezone.utc)
    else:
        msg.status = "DRAFT"
        msg.published_at = None

    try:
        await db.commit()
    except IntegrityError:  # 동시 최초 저장 경합(같은 슬롯 INSERT 2건)
        await db.rollback()
        raise CoachError("SLOT_CONFLICT", "동시에 저장되었습니다. 새로고침 후 다시 시도하세요.")
    await db.refresh(msg)
    return msg


async def list_slot_messages(db: AsyncSession, season_id: int, target_date: date) -> list[GameCoachMessage]:
    rows = await db.execute(
        select(GameCoachMessage)
        .where(GameCoachMessage.season_id == season_id, GameCoachMessage.target_date == target_date)
        .order_by(GameCoachMessage.coach_type.desc())  # MORNING, EVENING 순
    )
    return list(rows.scalars().all())


async def today_coach(
    db: AsyncSession, today: date
) -> tuple[int | None, GameCoachMessage | None, GameCoachMessage | None]:
    """(활성 시즌 id, 발행된 모닝, 발행된 이브닝). 활성 시즌 없으면 (None, None, None)."""
    season = await account_service.get_active_season(db)
    if season is None:
        return None, None, None
    rows = await db.execute(
        select(GameCoachMessage).where(
            GameCoachMessage.season_id == season.id,
            GameCoachMessage.target_date == today,
            GameCoachMessage.status == "PUBLISHED",
        )
    )
    by_type = {m.coach_type: m for m in rows.scalars().all()}
    return season.id, by_type.get("MORNING"), by_type.get("EVENING")


async def list_seasons(db: AsyncSession) -> list[GameSeason]:
    rows = await db.execute(select(GameSeason).order_by(GameSeason.id.desc()))
    return list(rows.scalars().all())


def to_dto(msg: GameCoachMessage) -> CoachMessageResponse:
    return CoachMessageResponse(
        id=msg.id, season_id=msg.season_id, target_date=msg.target_date,
        coach_type=msg.coach_type, title=msg.title, summary_nudge=msg.summary_nudge,
        content_md=msg.content_md, support_price=msg.support_price,
        resistance_price=msg.resistance_price, status=msg.status, published_at=msg.published_at,
    )


def _dec_str(v: Decimal | None) -> str | None:
    return None if v is None else str(v)


def coach_push_payload(msg: GameCoachMessage) -> dict:
    """발행 시 WS broadcast 페이로드(JSON 직렬화 가능)."""
    return {
        "type": "coach",
        "coach_type": msg.coach_type,
        "target_date": msg.target_date.isoformat(),
        "title": msg.title,
        "summary_nudge": msg.summary_nudge,
        "support_price": _dec_str(msg.support_price),
        "resistance_price": _dec_str(msg.resistance_price),
    }
```

- [ ] **Step 5: 통과 + 회귀** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v && uv run pytest -q` → 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/services/coach_service.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 데일리 코치 서비스 — 슬롯 upsert(초안/발행)·오늘 코칭 조회·푸시 페이로드

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 코치·시즌 REST 라우터

**Files:**
- Create: `backend/apps/trading_game/routers/coach.py`
- Modify: `backend/apps/trading_game/main.py` (라우터 등록)
- Test: `backend/tests/test_coach_and_nudge.py`

- [ ] **Step 1: 실패 테스트 추가** — httpx ASGITransport를 쓴다(lifespan을 실행하지 않으므로 리스너는 뜨지 않는다).

```python
# ---------------------------------------------------------------- coach router
import httpx

from shared.auth import get_current_user
from shared.database import get_db
from apps.trading_game.main import app
from apps.trading_game.services import connection_manager


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


def _body(season_id, action="draft", **over):
    b = {
        "season_id": season_id, "target_date": "2026-10-13", "coach_type": "MORNING",
        "title": "모닝 브리핑", "summary_nudge": "반도체 강세", "content_md": "## 시황",
        "support_price": 70000, "resistance_price": 75000, "action": action,
    }
    b.update(over)
    return b


async def test_router_admin_upsert_flow_and_broadcast(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        admin = await _seed_admin(db)
    set_user(admin)
    sent = []

    async def fake_broadcast(payload):
        sent.append(payload)

    monkeypatch.setattr(connection_manager.manager, "broadcast", fake_broadcast)

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id))
    assert r.status_code == 200 and r.json()["status"] == "DRAFT"
    assert sent == []  # 초안은 push 없음

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"
    assert len(sent) == 1 and sent[0]["type"] == "coach"

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id))
    assert r.status_code == 409

    r = await client.get("/api/game/admin/coach-messages",
                         params={"season_id": season.id, "target_date": "2026-10-13"})
    assert r.status_code == 200 and len(r.json()) == 1

    r = await client.get("/api/game/admin/seasons")
    assert r.status_code == 200 and r.json()[0]["ticker"] == "005930"


async def test_router_publish_succeeds_even_if_broadcast_fails(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_admin(db))

    async def boom(payload):
        raise RuntimeError("ws down")

    monkeypatch.setattr(connection_manager.manager, "broadcast", boom)
    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"


async def test_router_non_admin_forbidden_and_validation(api, maker):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        player = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
        db.add(player)
        await db.commit()
        await db.refresh(player)
        admin = await _seed_admin(db)
    set_user(player)
    assert (await client.put("/api/game/admin/coach-messages", json=_body(season.id))).status_code == 403
    assert (await client.get("/api/game/admin/seasons")).status_code == 403

    set_user(admin)
    bad = _body(season.id, support_price=80000, resistance_price=75000)
    assert (await client.put("/api/game/admin/coach-messages", json=bad)).status_code == 422
    assert (await client.put("/api/game/admin/coach-messages", json=_body(999))).status_code == 404
    bad_type = _body(season.id, coach_type="IN_PLAY")
    assert (await client.put("/api/game/admin/coach-messages", json=bad_type)).status_code == 422


async def test_router_coach_today(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        admin = await _seed_admin(db)
    set_user(admin)
    monkeypatch.setattr(coach_service, "kst_today", lambda: date(2026, 10, 13))

    async def noop(payload):
        return None

    monkeypatch.setattr(connection_manager.manager, "broadcast", noop)

    r = await client.get("/api/game/coach/today")
    assert r.status_code == 200
    assert r.json() == {"target_date": "2026-10-13", "season_id": season.id,
                        "morning": None, "evening": None, "active": None}

    await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    data = (await client.get("/api/game/coach/today")).json()
    assert data["morning"]["title"] == "모닝 브리핑"
    assert data["active"]["coach_type"] == "MORNING"

    await client.put("/api/game/admin/coach-messages",
                     json=_body(season.id, action="publish", coach_type="EVENING", title="이브닝"))
    data = (await client.get("/api/game/coach/today")).json()
    assert data["active"]["coach_type"] == "EVENING"
```

- [ ] **Step 2: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k router -v` → 404(라우트 없음)로 FAIL.

- [ ] **Step 3: 라우터 구현** `backend/apps/trading_game/routers/coach.py`

```python
"""데일리 스마트 코치 REST (Phase 5a) — 관리자 발행 + 유저 오늘 코칭 조회."""
from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user, require_admin
from shared.database import get_db
from shared.models import User
from apps.trading_game.schemas.game_dtos import (
    CoachMessageResponse, CoachTodayResponse, CoachUpsertRequest, SeasonOption,
)
from apps.trading_game.services import coach_service, connection_manager

router = APIRouter(prefix="/api/game", tags=["trading-game-coach"])
log = logging.getLogger("trading_game.coach")

_ERROR_STATUS = {
    "SEASON_NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "ALREADY_PUBLISHED": status.HTTP_409_CONFLICT,
    "SLOT_CONFLICT": status.HTTP_409_CONFLICT,
}


@router.put("/admin/coach-messages", response_model=CoachMessageResponse)
async def upsert_coach_message(
    body: CoachUpsertRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        msg = await coach_service.upsert_coach_message(db, req=body, author_id=admin.id)
    except coach_service.CoachError as e:
        raise HTTPException(_ERROR_STATUS[e.code], str(e))
    if body.action == "publish":
        try:
            await connection_manager.manager.broadcast(coach_service.coach_push_payload(msg))
        except Exception:
            log.warning("코치 발행 WS push 실패(발행은 정상 완료) id=%s", msg.id, exc_info=True)
    return coach_service.to_dto(msg)


@router.get("/admin/coach-messages", response_model=list[CoachMessageResponse])
async def list_coach_messages(
    season_id: int,
    target_date: date,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    rows = await coach_service.list_slot_messages(db, season_id, target_date)
    return [coach_service.to_dto(m) for m in rows]


@router.get("/admin/seasons", response_model=list[SeasonOption])
async def list_seasons(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return [
        SeasonOption(
            id=s.id, season_number=s.season_number, ticker=s.ticker, stock_name=s.stock_name,
            status=s.status, start_at=s.start_at, end_at=s.end_at,
        )
        for s in await coach_service.list_seasons(db)
    ]


@router.get("/coach/today", response_model=CoachTodayResponse)
async def coach_today(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    today = coach_service.kst_today()
    season_id, morning, evening = await coach_service.today_coach(db, today)
    m = coach_service.to_dto(morning) if morning else None
    e = coach_service.to_dto(evening) if evening else None
    return CoachTodayResponse(target_date=today, season_id=season_id, morning=m, evening=e, active=e or m)
```

- [ ] **Step 4: `main.py` 등록** — import를 `from apps.trading_game.routers import coach, leaderboard, orders, ws_gateway`로 바꾸고, `app.include_router(leaderboard.router)` 다음 줄에 `app.include_router(coach.router)`를 추가한다.

- [ ] **Step 5: 통과 + 회귀** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v && uv run pytest -q` → 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/routers/coach.py backend/apps/trading_game/main.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 코치 REST — 관리자 upsert/슬롯·시즌 조회 + 유저 오늘 코칭 + 발행 WS push

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 주문·수동청산 응답에 넛지 (best-effort)

**Files:**
- Modify: `backend/apps/trading_game/schemas/game_dtos.py`
- Modify: `backend/apps/trading_game/routers/orders.py`
- Test: `backend/tests/test_coach_and_nudge.py`

- [ ] **Step 1: DTO 추가** (`game_dtos.py`, `PositionResponse` 정의 **바로 아래**)

```python
class NudgeDTO(BaseModel):
    type: str      # WARNING | PRAISE | ADVICE
    code: str
    message: str


class OrderResultResponse(PositionResponse):
    """진입/수동청산 응답 — PositionResponse + 교육 넛지(Phase 5a). /positions/active 는 미사용."""
    nudges: list[NudgeDTO] = Field(default_factory=list)
```

- [ ] **Step 2: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- orders + nudges
from apps.trading_game.routers import orders as orders_router


@pytest.fixture
def order_env(monkeypatch):
    """거래창·신선가·Redis 를 고정. price["v"] 를 바꿔가며 사용."""
    price = {"v": Decimal("100")}
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def fresh(_redis, _ticker):
        return price["v"]

    async def no_rsi(*a, **k):
        return None

    monkeypatch.setattr(orders_router.market_clock, "in_trading_window", lambda *a, **k: True)
    monkeypatch.setattr(orders_router, "_require_fresh_price", fresh)
    monkeypatch.setattr(orders_router.deps, "get_redis", lambda: redis)
    monkeypatch.setattr(orders_router.rsi_service, "current_rsi", no_rsi)  # 기본: CH 조회 차단
    return price


async def _seed_player(db) -> User:
    u = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def test_open_order_returns_warning_and_advice(api, maker, monkeypatch, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_player(db))

    async def hot_rsi(*a, **k):
        return 85.0

    monkeypatch.setattr(orders_router.rsi_service, "current_rsi", hot_rsi)
    r = await client.post("/api/game/orders", json={
        "season_id": season.id, "side": "LONG", "ratio": 1.0, "leverage": 5,
    })
    assert r.status_code == 201, r.text
    assert [n["code"] for n in r.json()["nudges"]] == ["OVERBOUGHT_CHASE", "OVERLEVERAGE"]
    assert r.json()["status"] == "OPEN"


async def test_open_order_nudge_failure_does_not_break_order(api, maker, monkeypatch, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_player(db))

    def boom(**kw):
        raise RuntimeError("nudge bug")

    monkeypatch.setattr(orders_router.nudge_engine, "nudges_for_open", boom)
    r = await client.post("/api/game/orders", json={
        "season_id": season.id, "side": "SHORT", "ratio": 0.25, "leverage": 1,
    })
    assert r.status_code == 201
    assert r.json()["nudges"] == []


async def test_manual_close_praise_nudge(api, maker, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_player(db))
    r = await client.post("/api/game/orders", json={
        "season_id": season.id, "side": "LONG", "ratio": 0.25, "leverage": 1,
    })
    assert r.status_code == 201, r.text
    pos_id = r.json()["id"]
    order_env["v"] = Decimal("98.5")  # LONG 1x: -1.5% - 0.03% = -1.53%
    r = await client.post(f"/api/game/positions/{pos_id}/close")
    assert r.status_code == 200, r.text
    assert [n["code"] for n in r.json()["nudges"]] == ["PRINCIPLED_STOP"]


async def test_active_positions_response_has_no_nudges_field(api, maker, order_env):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_player(db))
    await client.post("/api/game/orders", json={
        "season_id": season.id, "side": "LONG", "ratio": 0.25, "leverage": 1,
    })
    r = await client.get("/api/game/positions/active", params={"season_id": season.id})
    assert r.status_code == 200
    assert len(r.json()) == 1 and "nudges" not in r.json()[0]
```
※ `/positions/active`는 `deps.get_redis()`로 최신가를 읽는다(fakeredis에는 값이 없으므로 roi는 None). 테스트는 필드 존재 여부만 확인한다.

- [ ] **Step 3: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k "order or close or active" -v` → `nudges` 키 없음으로 FAIL.

- [ ] **Step 4: 구현** — `orders.py` 수정:

import 블록에 `import asyncio`를 추가하고, 아래 두 import를 교체한다.
```python
from apps.trading_game.schemas.game_dtos import (
    AccountResponse, NudgeDTO, OrderRequest, OrderResultResponse, PositionResponse,
)
from apps.trading_game.services import (
    account_service, market_clock, nudge_engine, order_engine, pricing, ranking_service, rsi_service,
)
```
`_require_fresh_price` 아래에 헬퍼를 추가한다.
```python
RSI_TIMEOUT_SECONDS = 2.0


async def _open_nudges(redis, ticker: str, body: OrderRequest, entry_price: Decimal) -> list[NudgeDTO]:
    """진입 넛지 — 실패·지연 시 빈 목록(체결 응답을 막지 않는 best-effort)."""
    try:
        rsi = None
        if body.side == "LONG":
            rsi = await asyncio.wait_for(
                rsi_service.current_rsi(redis, ticker, entry_price), timeout=RSI_TIMEOUT_SECONDS
            )
        found = nudge_engine.nudges_for_open(
            side=body.side, ratio=body.ratio, leverage=body.leverage, rsi=rsi
        )
        return [NudgeDTO(**n.to_dict()) for n in found]
    except Exception:
        log.warning("진입 넛지 생성 실패(주문은 정상 체결)", exc_info=True)
        return []


def _close_nudges(closed_reason: str, roi_pct: Decimal | None) -> list[NudgeDTO]:
    try:
        found = nudge_engine.nudges_for_close(closed_reason=closed_reason, roi_pct=roi_pct)
        return [NudgeDTO(**n.to_dict()) for n in found]
    except Exception:
        log.warning("청산 넛지 생성 실패(청산은 정상 완료)", exc_info=True)
        return []
```
`open_order`의 데코레이터를 `@router.post("/orders", response_model=OrderResultResponse, status_code=status.HTTP_201_CREATED)`로 바꾸고, 마지막 `return _position_dto(pos, roi, pnl)`을 다음으로 교체한다.
```python
    dto = _position_dto(pos, roi, pnl)
    nudges = await _open_nudges(redis, season.ticker, body, entry_price)
    return OrderResultResponse(**dto.model_dump(), nudges=nudges)
```
`close_order`의 데코레이터를 `response_model=OrderResultResponse`로 바꾸고, 마지막 `return`을 다음으로 교체한다.
```python
    dto = _position_dto(refreshed, trade.roi_pct, trade.pnl_amount)
    return OrderResultResponse(**dto.model_dump(), nudges=_close_nudges("MANUAL", trade.roi_pct))
```
`active_positions`와 `PositionResponse`는 바꾸지 않는다.

- [ ] **Step 5: 통과 + 회귀** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v && uv run pytest -q` → 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/routers/orders.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 주문·수동청산 응답에 스마트 넛지(best-effort, RSI 2초 타임아웃)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 자동 청산 넛지 → WS (fan-out 큐 경유)

**Files:**
- Modify: `backend/apps/trading_game/services/liquidation_service.py`
- Modify: `backend/apps/trading_game/services/tick_listener.py`
- Test: `backend/tests/test_coach_and_nudge.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- auto-close nudge (WS)
import asyncio as _asyncio

from shared.game_models import GameAccount, GamePosition
from apps.trading_game.services import liquidation_service, tick_listener


async def _seed_open_position(db, *, sl=None, tp=None) -> tuple[int, GamePosition]:
    season = await _seed_season(db)
    user = await _seed_player(db)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    pos = GamePosition(
        account_id=acc.id, side="LONG", entry_price=Decimal("100"), size_amount=Decimal("1000000"),
        entry_ratio=Decimal("0.1"), leverage=1, status="OPEN",
        stop_loss_price=sl, take_profit_price=tp,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return user.id, pos


async def test_liquidate_for_tick_returns_user_id(session):
    user_id, pos = await _seed_open_position(session, sl=Decimal("98"))
    results = await liquidation_service.liquidate_for_tick(session, "005930", Decimal("98"))
    assert len(results) == 1
    assert results[0].user_id == user_id
    assert results[0].trade.closed_reason == "STOP_LOSS"
    # 하위 호환 래퍼는 여전히 GameTrade 목록(이미 청산되어 빈 목록)
    assert await liquidation_service.check_and_liquidate(session, "005930", Decimal("98")) == []


@pytest.fixture
def fresh_queue(monkeypatch):
    q: _asyncio.Queue = _asyncio.Queue(maxsize=256)
    monkeypatch.setattr(tick_listener, "_fanout_q", q)
    return q


@pytest.fixture
def listener_db(maker, monkeypatch):
    monkeypatch.setattr(tick_listener, "AsyncSessionLocal", maker)
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(tick_listener.deps, "get_redis", lambda: redis)
    return maker


def _drain(q):
    items = []
    while not q.empty():
        items.append(q.get_nowait())
    return items


async def test_handle_tick_stop_loss_enqueues_praise_nudge(listener_db, fresh_queue):
    async with listener_db() as db:
        user_id, pos = await _seed_open_position(db, sl=Decimal("98"))  # 98 → -2% - 0.03%
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 98}))
    items = _drain(fresh_queue)
    nudges = [i for i in items if i[0] == "nudge"]
    ticks = [i for i in items if i[0] == "tick"]
    assert len(ticks) == 1
    assert len(nudges) == 1
    _, uid, payload = nudges[0]
    assert uid == user_id
    assert payload["type"] == "nudge"
    assert payload["position_id"] == str(pos.id)
    assert payload["nudge"]["code"] == "PRINCIPLED_STOP"


async def test_handle_tick_take_profit_enqueues_no_nudge(listener_db, fresh_queue):
    async with listener_db() as db:
        await _seed_open_position(db, tp=Decimal("105"))
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 105}))
    assert [i[0] for i in _drain(fresh_queue)] == ["tick"]


async def test_fanout_worker_sends_nudge_to_user(fresh_queue, monkeypatch):
    sent = []

    async def fake_send(user_id, payload):
        sent.append((user_id, payload))

    monkeypatch.setattr(tick_listener.manager, "send_to_user", fake_send)
    stop = _asyncio.Event()
    tick_listener._enqueue_nudge(7, "pos-1", {"type": "PRAISE", "code": "PRINCIPLED_STOP", "message": "m"})
    task = _asyncio.create_task(tick_listener.fanout_worker(stop))
    for _ in range(50):
        if sent:
            break
        await _asyncio.sleep(0.02)
    stop.set()
    await task
    assert sent == [(7, {"type": "nudge", "position_id": "pos-1",
                         "nudge": {"type": "PRAISE", "code": "PRINCIPLED_STOP", "message": "m"}})]
```

- [ ] **Step 2: 실패 확인** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -k "liquidate or handle_tick or fanout" -v` → `liquidate_for_tick` 또는 `_enqueue_nudge` 없음으로 FAIL.

- [ ] **Step 3: `liquidation_service.py` 교체** — 파일 전체를 아래로 바꾼다(`check_and_liquidate`는 하위 호환 래퍼로 유지).

```python
"""실시간 틱 수신 시 TP/SL/마진콜 자동청산 검사기."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade
from apps.trading_game.services import order_engine, pricing


@dataclass(frozen=True)
class LiquidationResult:
    """청산 체결 + 소유자 user_id (청산 전에 함께 조회 — 청산 후 관계 lazy-load 금지)."""
    trade: GameTrade
    user_id: int


async def _open_positions_with_user(db: AsyncSession, ticker: str) -> list[tuple[GamePosition, int]]:
    rows = await db.execute(
        select(GamePosition, GameAccount.user_id)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .join(GameSeason, GameAccount.season_id == GameSeason.id)
        .where(
            GamePosition.status == "OPEN",
            GameSeason.ticker == ticker,
            GameSeason.status == "ACTIVE",
        )
    )
    return [(pos, user_id) for pos, user_id in rows.all()]


async def liquidate_for_tick(db: AsyncSession, ticker: str, price: Decimal) -> list[LiquidationResult]:
    """해당 ticker OPEN 포지션 중 청산조건 충족분을 청산하고 (체결, user_id) 목록 반환."""
    results: list[LiquidationResult] = []
    for pos, user_id in await _open_positions_with_user(db, ticker):
        reason = pricing.liquidation_reason(
            pos.side, pos.entry_price, price, pos.leverage,
            pos.stop_loss_price, pos.take_profit_price,
        )
        if reason is None:
            continue
        trade = await order_engine.close_position(
            db, position_id=pos.id, exit_price=price, reason=reason
        )
        if trade is not None:
            results.append(LiquidationResult(trade=trade, user_id=user_id))
    return results


async def check_and_liquidate(db: AsyncSession, ticker: str, price: Decimal) -> list[GameTrade]:
    """하위 호환 — 체결내역 목록만 반환."""
    return [r.trade for r in await liquidate_for_tick(db, ticker, price)]
```

- [ ] **Step 4: `tick_listener.py` 수정**

import에 `nudge_engine`을 추가한다.
```python
from apps.trading_game.services import (
    account_service, liquidation_service, nudge_engine, pricing, ranking_service,
)
```
`_enqueue_fanout`을 아래 네 함수로 교체한다(큐 항목은 종류 태그가 붙은 튜플: `("tick", tick, price)` / `("nudge", user_id, payload)`).
```python
def _enqueue(item: tuple) -> None:
    """fan-out 큐 적재(가득 차면 가장 오래된 것 드롭 — 청산/소비를 막지 않음)."""
    q = _get_fanout_queue()
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        pass


def _enqueue_fanout(tick: dict, price: Decimal) -> None:
    _enqueue(("tick", tick, price))


def _enqueue_nudge(user_id: int, position_id: str, nudge: dict) -> None:
    _enqueue(("nudge", user_id, {"type": "nudge", "position_id": position_id, "nudge": nudge}))


def _queue_close_nudges(result: liquidation_service.LiquidationResult) -> None:
    """자동청산 넛지를 큐에 적재 — 실패해도 청산·랭킹에 영향 없음(best-effort)."""
    try:
        trade = result.trade
        for n in nudge_engine.nudges_for_close(closed_reason=trade.closed_reason, roi_pct=trade.roi_pct):
            _enqueue_nudge(result.user_id, str(trade.position_id), n.to_dict())
    except Exception:
        log.warning("자동청산 넛지 적재 실패 — skip", exc_info=True)
```
`fanout_worker`의 while 루프 본문을 다음처럼 바꾼다(타임아웃·취소 처리와 종료 로그는 그대로 둔다).
```python
        try:
            item = await asyncio.wait_for(q.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            break
        try:
            if item[0] == "nudge":
                _, user_id, payload = item
                await manager.send_to_user(user_id, payload)
                continue
            _, tick, price = item
            await manager.broadcast({
                "type": "tick", "ticker": tick["ticker"], "price": tick["price"],
                "timestamp": tick.get("timestamp"),
            })
            await _push_personal_pnl(tick["ticker"], price)
        except Exception:
            log.exception("fan-out 실패 — skip")
```
`_handle_tick`을 다음으로 교체한다.
```python
async def _handle_tick(raw: str) -> None:
    tick = json.loads(raw)
    ticker = tick["ticker"]
    price = Decimal(str(tick["price"]))
    # 청산은 리스너 코루틴에서 인라인(정확성 우선)
    async with AsyncSessionLocal() as db:
        results = await liquidation_service.liquidate_for_tick(db, ticker, price)
        for r in results:
            await ranking_service.sync_account_rank(deps.get_redis(), db, r.trade.account_id)
            _queue_close_nudges(r)  # 인라인 send 금지 — 큐로 위임
    # fan-out 은 별도 워커로 위임(느린 클라이언트가 청산/소비를 막지 않게)
    _enqueue_fanout(tick, price)
```

- [ ] **Step 5: 통과 + 회귀** — Run: `cd backend && uv run pytest tests/test_coach_and_nudge.py -v && uv run pytest -q` → 전부 PASS(기존 `test_order_engine.py`의 `check_and_liquidate` 테스트 3개 포함).

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/services/liquidation_service.py backend/apps/trading_game/services/tick_listener.py backend/tests/test_coach_and_nudge.py
git commit -m "feat(game): 자동청산 넛지 WS push — user_id 선조회 + fan-out 큐 경유(best-effort)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: admin_web 게임 API 기반 (설정·클라이언트·타입·API 모듈)

**Files:**
- Modify: `admin_web/package.json`, `admin_web/package-lock.json`
- Modify: `admin_web/src/vite-env.d.ts`, `admin_web/src/config.ts`, `admin_web/src/api/client.ts`
- Create: `admin_web/src/types/game.ts`, `admin_web/src/api/coach.ts`

- [ ] **Step 1: 의존성 설치**

```bash
cd admin_web
npm install marked@^15 dompurify@^3
find node_modules/marked node_modules/dompurify -maxdepth 3 -name "*.d.ts" -o -maxdepth 3 -name "*.d.mts" | head
```
Expected: 두 패키지 모두 자체 타입 선언 파일을 포함한다. `@types/marked`·`@types/dompurify`는 **추가하지 않는다**(dompurify 3.2+와 marked는 타입을 동봉한다). 타입 파일이 없으면 DONE_WITH_CONCERNS로 보고한다.

- [ ] **Step 2: `src/vite-env.d.ts`** — `ImportMetaEnv`에 한 줄 추가한다.

```ts
  readonly VITE_GAME_API_URL?: string
```

- [ ] **Step 3: `src/config.ts`** — 파일 끝에 추가한다(기존 `readEnv`와 3개 export는 그대로 둔다).

```ts
// trading_game(게임) 서비스 — 선택 변수.
//   dev(vite serve): 미설정 시 localhost:8003
//   배포 빌드: 미설정이면 undefined → 코치 화면이 "게임 서버 미연결" 안내(빌드는 깨지 않음).
//   운영에 trading_game 이 배포되기 전까지 vite.config.js REQUIRED 에 넣지 않는다.
export const GAME_API_URL: string | undefined =
  import.meta.env.VITE_GAME_API_URL || (import.meta.env.DEV ? 'http://localhost:8003' : undefined)
```

- [ ] **Step 4: `src/api/client.ts`** — config import 줄을 `import { API_BASE_URL as BLOG_BASE_URL, AUTH_BASE_URL, GAME_API_URL } from '../config'`로 바꾸고, `export default blogClient` 바로 위에 추가한다.

```ts
// 게임 서비스(trading_game) — 미설정 배포에서는 null(호출부가 미연결 안내)
export const gameClient: AxiosInstance | null = GAME_API_URL ? makeClient(GAME_API_URL) : null
```

- [ ] **Step 5: `src/types/game.ts`** (출처: `backend/apps/trading_game/schemas/game_dtos.py`의 Phase 5a DTO)

```ts
// trading_game 코치·시즌 DTO. 출처: backend/apps/trading_game/schemas/game_dtos.py (Phase 5a)
// pydantic Decimal → JSON 문자열, date/datetime → ISO 문자열.

export type CoachType = 'MORNING' | 'EVENING'
export type CoachStatus = 'DRAFT' | 'PUBLISHED'
export type CoachAction = 'draft' | 'publish'

export interface CoachMessage {
  id: number
  season_id: number
  target_date: string // YYYY-MM-DD
  coach_type: CoachType
  title: string
  summary_nudge: string
  content_md: string
  support_price: string | null
  resistance_price: string | null
  status: CoachStatus
  published_at: string | null
}

export interface CoachUpsertBody {
  season_id: number
  target_date: string
  coach_type: CoachType
  title: string
  summary_nudge: string
  content_md: string
  support_price: number | null
  resistance_price: number | null
  action: CoachAction
}

export interface SeasonOption {
  id: number
  season_number: number
  ticker: string
  stock_name: string
  status: string // READY | ACTIVE | FINISHED
  start_at: string
  end_at: string | null
}
```

- [ ] **Step 6: `src/api/coach.ts`**

```ts
import type { AxiosInstance } from 'axios'
import { gameClient } from './client'
import type { CoachMessage, CoachUpsertBody, SeasonOption } from '../types/game'

// 데일리 코치 API (trading_game). gameClient 가 없으면(미설정 배포) 명확한 에러.
function requireGameClient(): AxiosInstance {
  if (!gameClient) throw new Error('게임 서버(VITE_GAME_API_URL)가 설정되지 않았습니다.')
  return gameClient
}

export const listSeasons = async (): Promise<SeasonOption[]> => {
  const { data } = await requireGameClient().get<SeasonOption[]>('/api/game/admin/seasons')
  return data
}

export const listCoachMessages = async (
  seasonId: number,
  targetDate: string,
): Promise<CoachMessage[]> => {
  const { data } = await requireGameClient().get<CoachMessage[]>('/api/game/admin/coach-messages', {
    params: { season_id: seasonId, target_date: targetDate },
  })
  return data
}

export const upsertCoachMessage = async (body: CoachUpsertBody): Promise<CoachMessage> => {
  const { data } = await requireGameClient().put<CoachMessage>('/api/game/admin/coach-messages', body)
  return data
}
```

- [ ] **Step 7: 검증** — 공통 규칙 6의 명령(`tsc` + 더미 env 빌드)을 실행해 둘 다 통과시킨다. 이어서 `VITE_GAME_API_URL` 미설정 배포 빌드에 dev 폴백이 구워지지 않았는지 확인한다.

```bash
cd admin_web
grep -l "localhost:8003" dist/assets/*.js && echo "UNEXPECTED: dev fallback baked" || echo "OK: no dev fallback in prod bundle"
```
Expected: `OK: ...`. 프로덕션 빌드에서는 `import.meta.env.DEV`가 false로 치환되어 데드 코드가 제거된다.

- [ ] **Step 8: 커밋**

```bash
cd ..
git add admin_web/package.json admin_web/package-lock.json admin_web/src/vite-env.d.ts admin_web/src/config.ts admin_web/src/api/client.ts admin_web/src/types/game.ts admin_web/src/api/coach.ts
git commit -m "feat(admin): 게임 API 기반 — 선택 VITE_GAME_API_URL·gameClient·코치 DTO 타입·API 모듈

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: admin_web 데일리 코치 화면

**Files:**
- Create: `admin_web/src/pages/TradingGameCoach.tsx`
- Modify: `admin_web/src/components/Sidebar.tsx`, `admin_web/src/App.tsx`

- [ ] **Step 1: 페이지 작성** `admin_web/src/pages/TradingGameCoach.tsx`

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { AxiosError } from 'axios'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { GAME_API_URL } from '../config'
import { listCoachMessages, listSeasons, upsertCoachMessage } from '../api/coach'
import { showToast } from '../lib/toast'
import type { CoachAction, CoachMessage, CoachType, SeasonOption } from '../types/game'

// KST 오늘(YYYY-MM-DD) — en-CA 로케일은 ISO 날짜 형식으로 포맷된다
const kstToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())

interface CoachForm {
  title: string
  summary_nudge: string
  support_price: string
  resistance_price: string
  content_md: string
}

const EMPTY_FORM: CoachForm = {
  title: '',
  summary_nudge: '',
  support_price: '',
  resistance_price: '',
  content_md: '',
}

const priceToInput = (v: string | null): string => (v === null ? '' : String(Number(v)))
const inputToPrice = (s: string): number | null => (s.trim() === '' ? null : Number(s))

const toForm = (m: CoachMessage): CoachForm => ({
  title: m.title,
  summary_nudge: m.summary_nudge,
  support_price: priceToInput(m.support_price),
  resistance_price: priceToInput(m.resistance_price),
  content_md: m.content_md,
})

const errorMessage = (caught: unknown): string => {
  const err = caught as AxiosError<{ detail?: unknown }>
  const detail = err.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return '입력값을 확인하세요.'
  if (err.response) return `요청 실패 (HTTP ${err.response.status})`
  return '게임 서버에 연결할 수 없습니다.'
}

const validate = (f: CoachForm): string | null => {
  if (!f.title.trim()) return '제목을 입력하세요.'
  if (!f.summary_nudge.trim()) return '한 줄 넛지를 입력하세요.'
  if (!f.content_md.trim()) return '상세 시황을 입력하세요.'
  const s = inputToPrice(f.support_price)
  const r = inputToPrice(f.resistance_price)
  if ((s !== null && !(s > 0)) || (r !== null && !(r > 0))) return '지지/저항선은 0보다 큰 숫자여야 합니다.'
  if (s !== null && r !== null && s >= r) return '지지선은 저항선보다 낮아야 합니다.'
  return null
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none'

function CoachEditor() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [seasonId, setSeasonId] = useState<number | null>(null)
  const [coachType, setCoachType] = useState<CoachType>('MORNING')
  const [targetDate, setTargetDate] = useState<string>(kstToday)
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM)
  const [current, setCurrent] = useState<CoachMessage | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  // 시즌 목록 — 기본은 ACTIVE 시즌
  useEffect(() => {
    listSeasons()
      .then((rows) => {
        setSeasons(rows)
        const active = rows.find((s) => s.status === 'ACTIVE') ?? rows[0]
        setSeasonId(active ? active.id : null)
      })
      .catch((e: unknown) => showToast(errorMessage(e), { icon: '⚠️' }))
  }, [])

  // 슬롯(시즌·날짜·모닝/이브닝) 변경 시 기존 내용 불러오기
  useEffect(() => {
    if (seasonId === null) return
    let cancelled = false
    setLoading(true)
    listCoachMessages(seasonId, targetDate)
      .then((rows) => {
        if (cancelled) return
        const found = rows.find((m) => m.coach_type === coachType) ?? null
        setCurrent(found)
        setForm(found ? toForm(found) : EMPTY_FORM)
      })
      .catch((e: unknown) => {
        if (!cancelled) showToast(errorMessage(e), { icon: '⚠️' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seasonId, targetDate, coachType])

  // 미리보기 — marked(동기 모드) → DOMPurify 로 XSS 제거
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(form.content_md, { async: false })),
    [form.content_md],
  )

  const isPublished = current?.status === 'PUBLISHED'
  const setField = (k: keyof CoachForm) => (value: string) => setForm((f) => ({ ...f, [k]: value }))

  const submit = async (action: CoachAction) => {
    const err = validate(form)
    if (err) {
      showToast(err, { icon: '⚠️' })
      return
    }
    if (seasonId === null) {
      showToast('시즌을 선택하세요.', { icon: '⚠️' })
      return
    }
    setSaving(true)
    try {
      const saved = await upsertCoachMessage({
        season_id: seasonId,
        target_date: targetDate,
        coach_type: coachType,
        title: form.title.trim(),
        summary_nudge: form.summary_nudge.trim(),
        content_md: form.content_md,
        support_price: inputToPrice(form.support_price),
        resistance_price: inputToPrice(form.resistance_price),
        action,
      })
      setCurrent(saved)
      setForm(toForm(saved))
      showToast(action === 'publish' ? '브리핑을 실시간 발행했습니다.' : '임시저장했습니다.', {
        icon: action === 'publish' ? '🚀' : '✅',
      })
    } catch (e) {
      showToast(errorMessage(e), { icon: '⚠️' })
    } finally {
      setSaving(false)
    }
  }

  const typeBtn = (t: CoachType, label: string) => (
    <button
      type="button"
      onClick={() => setCoachType(t)}
      aria-pressed={coachType === t}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
        coachType === t ? 'bg-indigo-600 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-slate-900">데일리 코치</h2>
        {current && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isPublished
              ? `발행됨 · ${current.published_at ? new Date(current.published_at).toLocaleString('ko-KR') : ''}`
              : '임시저장(초안)'}
          </span>
        )}
      </div>

      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">시즌</label>
            <select
              value={seasonId ?? ''}
              onChange={(e) => setSeasonId(e.target.value === '' ? null : Number(e.target.value))}
              className={inputCls}
            >
              {seasons.length === 0 && <option value="">시즌 없음</option>}
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.season_number}기 · {s.stock_name}({s.ticker}) · {s.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">날짜</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-600">브리핑</span>
            <div className="flex gap-2" role="group" aria-label="브리핑 종류">
              {typeBtn('MORNING', '🌅 모닝 시황')}
              {typeBtn('EVENING', '🌙 이브닝 복기')}
            </div>
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">제목</label>
              <input
                value={form.title}
                maxLength={100}
                onChange={(e) => setField('title')(e.target.value)}
                placeholder="예: 반도체 강세 속 외국인 순매수 전환"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1 flex justify-between text-sm font-medium text-slate-600">
                <span>한 줄 넛지 (차트 상단 롤링 멘트)</span>
                <span className="text-xs font-normal text-slate-400">{form.summary_nudge.length}/200</span>
              </label>
              <input
                value={form.summary_nudge}
                maxLength={200}
                onChange={(e) => setField('summary_nudge')(e.target.value)}
                placeholder="예: 72,000원 지지 확인 전까지 추격 매수 자제"
                className={inputCls}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">지지선 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={form.support_price}
                  onChange={(e) => setField('support_price')(e.target.value)}
                  placeholder="비우면 표시 안 함"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">저항선 (원)</label>
                <input
                  type="number"
                  min={0}
                  value={form.resistance_price}
                  onChange={(e) => setField('resistance_price')(e.target.value)}
                  placeholder="비우면 표시 안 함"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">상세 시황 (마크다운)</span>
                <div className="flex gap-1 lg:hidden" role="tablist">
                  {(['write', 'preview'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={`rounded px-2 py-1 text-xs font-medium ${
                        tab === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {t === 'write' ? '작성' : '미리보기'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <textarea
                  value={form.content_md}
                  onChange={(e) => setField('content_md')(e.target.value)}
                  placeholder={'## 오늘의 시황\n- 외국인 순매수 전환\n- 72,000원 지지 여부 주목'}
                  className={`${inputCls} min-h-[320px] font-mono ${tab === 'write' ? '' : 'hidden'} lg:block`}
                />
                <div
                  className={`prose max-w-none min-h-[320px] overflow-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm ${
                    tab === 'preview' ? '' : 'hidden'
                  } lg:block`}
                  // DOMPurify 로 정화된 HTML 만 주입
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {isPublished && (
                <p className="mr-auto text-xs text-slate-400">발행된 브리핑은 다시 발행해서 수정합니다.</p>
              )}
              <button
                type="button"
                onClick={() => submit('draft')}
                disabled={saving || isPublished}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                임시저장
              </button>
              <button
                type="button"
                onClick={() => submit('publish')}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? '처리 중…' : '🚀 실시간 발행하기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function TradingGameCoach() {
  if (!GAME_API_URL) {
    return (
      <div>
        <h2 className="mb-6 text-2xl font-bold text-slate-900">데일리 코치</h2>
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-3xl">🔌</p>
          <p className="mt-3 font-medium text-slate-600">게임 서버 미연결</p>
          <p className="mt-1 text-sm text-slate-400">
            VITE_GAME_API_URL 을 설정해 빌드하면 데일리 코치를 사용할 수 있습니다.
          </p>
        </div>
      </div>
    )
  }
  return <CoachEditor />
}
```
설치된 marked 버전에서 `marked.parse(md, { async: false })`의 반환 타입이 `string | Promise<string>`이면, 그 한 곳만 `marked.parse(form.content_md, { async: false }) as string`으로 경계 단언하고 사유 주석을 단다(`// async:false 이면 런타임 반환은 항상 string`).

- [ ] **Step 2: `Sidebar.tsx`** — `NAV_GROUPS` 배열에서 '블로그 관리' 그룹 다음에 추가한다.

```tsx
  {
    title: '트레이딩 게임',
    items: [{ to: '/game/coach', label: '데일리 코치', icon: '📣' }],
  },
```

- [ ] **Step 3: `App.tsx`** — import 목록에 `import TradingGameCoach from './pages/TradingGameCoach'`를 추가하고, `<Route path="stats" .../>` 다음에 추가한다.

```tsx
        <Route path="game/coach" element={<TradingGameCoach />} />
```

- [ ] **Step 4: 검증** — 공통 규칙 6의 명령(`tsc` + 더미 env 빌드). `@tailwindcss/typography`가 없으면 `prose` 클래스는 효과가 없다(기존 RichTextEditor도 같은 클래스를 쓰는 기존 관례이므로 그대로 둔다).

- [ ] **Step 5: 커밋**

```bash
git add admin_web/src/pages/TradingGameCoach.tsx admin_web/src/components/Sidebar.tsx admin_web/src/App.tsx
git commit -m "feat(admin): 데일리 코치 화면 — 슬롯 불러오기·초안/발행·마크다운 미리보기(DOMPurify)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 10: 문서 + 통합 스모크 (컨트롤러 수행)

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`

- [ ] **Step 1: README**
  - trading_game 8003 섹션: 코치 API 4개(`PUT/GET /api/game/admin/coach-messages`, `GET /api/game/admin/seasons`, `GET /api/game/coach/today`)와 넛지(주문·청산 응답 `nudges`, WS `{type:"nudge"}`·`{type:"coach"}`), RSI 캐시 키(`game:rsi:closes:{ticker}:{YYYYMMDD}`)를 추가한다.
  - admin_web 섹션과 환경변수 표: `VITE_GAME_API_URL`(선택, dev 기본 `http://localhost:8003`, 배포 미설정 시 코치 화면 "미연결" 안내)을 추가한다.
- [ ] **Step 2: ROADMAP**
  - 서브페이즈 5 줄을 5a(완료)와 5b(대기)로 나누고, 완료 섹션에 Phase 5a 항목을 추가한다.
  - 상시 백로그에 "trading_game 운영 배포 — prod compose 미포함, 운영 호스트 8003은 blog_api가 사용 중이므로 포트 재배정 필요, Cloudflare 서브도메인·KIS WS 데몬 포함, 이후 VITE_GAME_API_URL 주입"을 추가한다.
- [ ] **Step 3: 통합 스모크(일회용 DB)**
  - `docker exec stock_postgres createdb -U stock_user stock_p5a_smoke` → `ALEMBIC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p5a_smoke uv run alembic upgrade head`
  - 같은 DB를 `DATABASE_URL`/`SYNC_DATABASE_URL` 환경변수로 지정해 관리자 시드(`uv run python -m apps.auth.seed_admin`)와 시즌 시드(`uv run python scripts/seed_trading_game.py`)를 실행한다.
  - auth(8001)와 trading_game(8003, `--workers 1`)을 같은 DB로 띄우고, admin_web dev(5173)를 띄운다.
  - 브라우저 확인:
    1. 사이드바 "트레이딩 게임 > 데일리 코치"
    2. 시즌 기본 선택(ACTIVE)
    3. 초안 저장 → 새로고침 후 불러오기
    4. 발행 → 배지 변경, 임시저장 비활성화
    5. 이브닝 슬롯 전환 시 빈 폼
    6. 미리보기에 `<script>alert(1)</script>`와 `<img src=x onerror=alert(1)>`를 넣어 정화되는지 확인
    7. 지지 ≥ 저항일 때 토스트
    8. `curl`로 `/api/game/coach/today` 응답 확인(토큰 필요)
  - 정리: 서버 종료, `docker exec stock_postgres dropdb -U stock_user stock_p5a_smoke`
- [ ] **Step 4: 커밋 (문서)**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP 현행화 — 트레이딩 게임 Phase 5a(코치·넛지)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

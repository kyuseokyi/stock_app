# 트레이딩 게임 Phase 3 — 가상 주문/체결 엔진 + WS 게이트웨이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ACTIVE 시즌 지정 종목에 대해 원클릭 가상 주문(LONG/SHORT·레버리지 1/2/5·비중 25/50/100%)을 현재가로 즉시 체결하고, 실시간 틱마다 TP/SL/마진콜 자동청산하며, 클라이언트에 틱·개인손익·시장심리를 push하는 백엔드(FastAPI, Port 8003)를 구축한다.

**Architecture:** 순수 수식(`pricing.py`)을 서비스/IO에서 분리해 테스트 핵심으로 삼는다. 주문 진입은 REST가 Redis 최신가(`stock:latest`)를 읽어 이중 게이트(거래 세션 창 + 신선도) 통과 후 `order_engine`에 넘긴다. 자동청산은 `lifespan`의 Redis 구독 리스너(단일 워커)가 틱마다 수행하고, 같은 틱을 WS 클라이언트에 Fan-out한다. 동시성은 조건부 UPDATE(`WHERE status='OPEN'` + rowcount)로 보호한다.

**Tech Stack:** FastAPI, asyncio, redis.asyncio, async SQLAlchemy 2, Alembic, pytest(+pytest-asyncio, aiosqlite). 스펙: `docs/superpowers/specs/2026-10-12-trading-game-phase3-order-engine-gateway-design.md`.

**공통 규칙:**
- 모든 명령은 `backend/`에서 `uv run ...`. 테스트는 `asyncio_mode=auto`라 `@pytest.mark.asyncio` 불필요.
- 커밋 attribution 2줄(세션별 지정):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- `git add -A`/`git add .` 금지 — 각 Task의 명시 경로만 add.
- 금액·가격·비율은 전부 `Decimal`. 틱의 int/float는 `Decimal(str(x))`로 변환 후 연산.

---

### Task 1: 순수 수식 모듈 `pricing.py`

의존성 없는 순수 함수. ROI는 **퍼센트** 단위, 왕복 수수료 0.03%p 차감. SL/TP 입력은 **분수**(0.05=5%).

**Files:**
- Create: `backend/apps/trading_game/__init__.py` (빈 파일)
- Create: `backend/apps/trading_game/services/__init__.py` (빈 파일)
- Create: `backend/apps/trading_game/services/pricing.py`
- Test: `backend/tests/test_order_engine.py`

- [ ] **Step 1: 패키지 초기화 파일 생성**

`backend/apps/trading_game/__init__.py` 와 `backend/apps/trading_game/services/__init__.py` 를 빈 파일로 생성.

- [ ] **Step 2: 실패하는 테스트 작성**

`backend/tests/test_order_engine.py`:
```python
"""트레이딩 게임 Phase 3 — 주문/체결 엔진 단위 테스트.

순수 수식(pricing)은 IO 없이 검증하고, 서비스 계층은 self-contained aiosqlite
인메모리 세션(tests/test_game_models.py 패턴)으로 검증한다.
"""
from __future__ import annotations

from decimal import Decimal

from apps.trading_game.services import pricing


def test_roi_long_no_leverage():
    # +10% 상승, 1x → 10% - 0.03% 수수료
    roi = pricing.compute_roi_pct("LONG", Decimal("100"), Decimal("110"), 1)
    assert roi == Decimal("9.97")


def test_roi_long_5x():
    # +10% 상승, 5x → 50% - 0.03%
    roi = pricing.compute_roi_pct("LONG", Decimal("100"), Decimal("110"), 5)
    assert roi == Decimal("49.97")


def test_roi_short_profit_on_drop():
    # SHORT 는 하락 시 이익: -10% 하락, 2x → 20% - 0.03%
    roi = pricing.compute_roi_pct("SHORT", Decimal("100"), Decimal("90"), 2)
    assert roi == Decimal("19.97")


def test_pnl_from_roi():
    pnl = pricing.compute_pnl(Decimal("1000000"), Decimal("9.97"))
    assert pnl == Decimal("99700.00")


def test_tp_sl_prices_long():
    sl, tp = pricing.tp_sl_prices("LONG", Decimal("100"), Decimal("0.05"), Decimal("0.10"))
    assert sl == Decimal("95.00")
    assert tp == Decimal("110.00")


def test_tp_sl_prices_short():
    sl, tp = pricing.tp_sl_prices("SHORT", Decimal("100"), Decimal("0.05"), Decimal("0.10"))
    assert sl == Decimal("105.00")
    assert tp == Decimal("90.00")


def test_tp_sl_prices_none_when_pct_missing():
    sl, tp = pricing.tp_sl_prices("LONG", Decimal("100"), None, None)
    assert sl is None and tp is None


def test_liquidation_take_profit_long():
    # TP=110 도달
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("110"), 1, Decimal("95"), Decimal("110")
    )
    assert reason == "TAKE_PROFIT"


def test_liquidation_stop_loss_long():
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("95"), 1, Decimal("95"), Decimal("110")
    )
    assert reason == "STOP_LOSS"


def test_liquidation_margin_call_priority():
    # 5x, -20% 하락 → ROI -100% ≤ -80% → SL 미설정이어도 마진콜
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("80"), 5, None, None
    )
    assert reason == "MARGIN_CALL"


def test_liquidation_none_when_untriggered():
    reason = pricing.liquidation_reason(
        "LONG", Decimal("100"), Decimal("101"), 1, Decimal("95"), Decimal("110")
    )
    assert reason is None
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.trading_game.services.pricing'`

- [ ] **Step 4: `pricing.py` 구현**

`backend/apps/trading_game/services/pricing.py`:
```python
"""가상 주문 손익/청산 순수 수식 (IO 의존성 없음).

ROI 단위 = 퍼센트(예: 9.97 = +9.97%). 왕복 수수료 0.03%p 차감.
SL/TP 입력 pct = 분수(0.05 = 5%). 모든 수는 Decimal.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

FEE_ROUNDTRIP_PCT = Decimal("0.03")      # 왕복 수수료 %p (편도 0.015 × 2)
MARGIN_CALL_ROI_PCT = Decimal("-80")     # 평가손실 ROI 임계
_PCT_Q = Decimal("0.0001")               # roi_pct Numeric(8,4)
_MONEY_Q = Decimal("0.01")               # 금액 Numeric(15,2)


def compute_roi_pct(side: str, entry: Decimal, cur: Decimal, leverage: int) -> Decimal:
    """방향·레버리지 반영 ROI(%) — 수수료 차감 후, 소수 4자리 반올림."""
    if side == "LONG":
        move = (cur - entry) / entry
    else:  # SHORT
        move = (entry - cur) / entry
    roi = move * Decimal(leverage) * Decimal("100") - FEE_ROUNDTRIP_PCT
    return roi.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


def compute_pnl(size_amount: Decimal, roi_pct: Decimal) -> Decimal:
    """평가손익 금액 = 원금 × roi% / 100, 2자리 반올림."""
    return (size_amount * roi_pct / Decimal("100")).quantize(_MONEY_Q, rounding=ROUND_HALF_UP)


def tp_sl_prices(
    side: str, entry: Decimal, sl_pct: Decimal | None, tp_pct: Decimal | None
) -> tuple[Decimal | None, Decimal | None]:
    """TP/SL 절대가. pct=분수. LONG/SHORT 방향별 부호."""
    sl = tp = None
    if sl_pct is not None:
        f = abs(sl_pct)
        sl = entry * (Decimal("1") - f) if side == "LONG" else entry * (Decimal("1") + f)
        sl = sl.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)
    if tp_pct is not None:
        f = abs(tp_pct)
        tp = entry * (Decimal("1") + f) if side == "LONG" else entry * (Decimal("1") - f)
        tp = tp.quantize(_MONEY_Q, rounding=ROUND_HALF_UP)
    return sl, tp


def liquidation_reason(
    side: str,
    entry: Decimal,
    cur: Decimal,
    leverage: int,
    sl_price: Decimal | None,
    tp_price: Decimal | None,
) -> str | None:
    """청산 사유 판정. 우선순위: MARGIN_CALL > STOP_LOSS > TAKE_PROFIT."""
    roi = compute_roi_pct(side, entry, cur, leverage)
    if roi <= MARGIN_CALL_ROI_PCT:
        return "MARGIN_CALL"
    if side == "LONG":
        if sl_price is not None and cur <= sl_price:
            return "STOP_LOSS"
        if tp_price is not None and cur >= tp_price:
            return "TAKE_PROFIT"
    else:  # SHORT
        if sl_price is not None and cur >= sl_price:
            return "STOP_LOSS"
        if tp_price is not None and cur <= tp_price:
            return "TAKE_PROFIT"
    return None
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -v`
Expected: PASS (11 tests)

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/__init__.py backend/apps/trading_game/services/__init__.py backend/apps/trading_game/services/pricing.py backend/tests/test_order_engine.py
git commit -m "feat(game): Phase 3 순수 손익/청산 수식(pricing) + 단위테스트"
```

---

### Task 2: Phase 2 publisher 최신가 캐시(`stock:latest`) 기록

주문 진입가 소스. PUBLISH와 동일 파이프라인에서 `SET stock:latest:{ticker}` 추가(additive·회귀안전).

**Files:**
- Modify: `backend/apps/collector/game_ws/publisher.py`
- Test: `backend/tests/test_game_ws_mock.py` (기존 파일에 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_game_ws_mock.py` 끝에 추가

```python
def test_publisher_builds_latest_payload():
    """publish 시 stock:latest 에 넣을 price/ts 페이로드를 만든다(순수 헬퍼)."""
    from apps.collector.game_ws.publisher import build_latest_payload
    import json

    tick = {"ticker": "005930", "price": 71500, "timestamp": "2026-10-12T09:00:05+09:00"}
    raw = build_latest_payload(tick)
    data = json.loads(raw)
    assert data["price"] == 71500
    assert isinstance(data["ts"], (int, float))
    assert data["ts"] > 0
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_game_ws_mock.py::test_publisher_builds_latest_payload -v`
Expected: FAIL — `ImportError: cannot import name 'build_latest_payload'`

- [ ] **Step 3: `publisher.py` 수정**

`backend/apps/collector/game_ws/publisher.py` 전체를 아래로 교체:
```python
"""Redis Pub/Sub 틱 발행기(async).

- 채널 stock:tick:{ticker} 로 PUBLISH (Phase 2, 휘발성 실시간 중계)
- 키 stock:latest:{ticker} 에 SET (Phase 3, 주문 진입가용 최신가 스냅샷, TTL 120s)
  PUBLISH 와 동일 파이프라인에서 함께 수행(단일 writer, additive).
"""
from __future__ import annotations

import json
import time

import redis.asyncio as aioredis

LATEST_TTL_SECONDS = 120


def build_latest_payload(tick: dict) -> str:
    """stock:latest 에 저장할 {price, ts(epoch seconds)} JSON."""
    return json.dumps({"price": tick["price"], "ts": time.time()})


class TickPublisher:
    def __init__(self, redis_url: str):
        self._redis = aioredis.from_url(redis_url, decode_responses=True)

    async def publish(self, tick: dict) -> int:
        """tick 을 stock:tick:{ticker} 로 PUBLISH + stock:latest:{ticker} SET(파이프라인)."""
        ticker = tick["ticker"]
        pipe = self._redis.pipeline()
        pipe.publish(f"stock:tick:{ticker}", json.dumps(tick, ensure_ascii=False))
        pipe.set(f"stock:latest:{ticker}", build_latest_payload(tick), ex=LATEST_TTL_SECONDS)
        results = await pipe.execute()
        return int(results[0])  # 수신 구독자 수

    async def close(self) -> None:
        await self._redis.aclose()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `uv run pytest tests/test_game_ws_mock.py -v`
Expected: PASS (기존 테스트 + 신규 1건)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/collector/game_ws/publisher.py backend/tests/test_game_ws_mock.py
git commit -m "feat(game): publisher 가 stock:latest 최신가 캐시 기록(Phase 3 진입가용)"
```

---

### Task 3: 스키마 확장 — `game_trades`/`game_positions` 필드 + 1포지션 부분 유니크 인덱스

Phase 4 MBTI 소비 필드를 추가하고, 1계좌 1활성포지션을 DB 레벨로 강제. 모델(`create_all`로 테스트 반영) + Alembic 마이그레이션(실 PG) 둘 다.

**Files:**
- Modify: `backend/shared/game_models.py`
- Create: `backend/alembic/versions/a1b2c3d4e5f6_game_phase3_trade_fields.py`
- Test: `backend/tests/test_order_engine.py` (제약 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_order_engine.py` 상단 import 및 세션 하니스 추가 후 테스트 추가

파일 상단 import 블록에 추가:
```python
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade, INITIAL_CASH
```

파일에 세션 픽스처 + 헬퍼 + 제약 테스트 추가:
```python
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


async def _seed_account(session) -> GameAccount:
    user = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc), status="ACTIVE",
    )
    session.add_all([user, season])
    await session.commit()
    await session.refresh(user)
    await session.refresh(season)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return acc


def _position(acc: GameAccount, **over) -> GamePosition:
    kw = dict(
        account_id=acc.id, side="LONG", entry_price=Decimal("100"),
        size_amount=Decimal("1000000"), entry_ratio=Decimal("0.1"), leverage=1, status="OPEN",
    )
    kw.update(over)
    return GamePosition(**kw)


async def test_single_open_position_constraint(session):
    acc = await _seed_account(session)
    session.add(_position(acc))
    await session.commit()
    session.add(_position(acc))  # 두 번째 OPEN → 부분 유니크 위반
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_second_open_allowed_after_close(session):
    acc = await _seed_account(session)
    p1 = _position(acc)
    session.add(p1)
    await session.commit()
    p1.status = "CLOSED"
    await session.commit()
    session.add(_position(acc))  # 이전 것이 CLOSED 라 허용
    await session.commit()
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py::test_single_open_position_constraint -v`
Expected: FAIL — 두 번째 커밋이 IntegrityError 를 안 냄(인덱스 없음) 또는 `entry_ratio` 컬럼 없음 에러

- [ ] **Step 3: 모델 수정** — `backend/shared/game_models.py`

import 에 `Boolean`, `Index`, `text` 추가:
```python
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
```

`GamePosition` 에 `entry_ratio` 컬럼 + `__table_args__` 추가 (기존 컬럼 뒤, `account` relationship 앞):
```python
    entry_ratio: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))

    __table_args__ = (
        Index(
            "uq_account_single_open",
            "account_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            sqlite_where=text("status = 'OPEN'"),
        ),
    )
```

`GameTrade` 에 필드 추가 (`closed_reason` 앞):
```python
    size_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    leverage: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    entry_ratio: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    had_stop_loss: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -v`
Expected: PASS (Task1 11건 + 제약 2건)

- [ ] **Step 5: Alembic 마이그레이션 작성** — `backend/alembic/versions/a1b2c3d4e5f6_game_phase3_trade_fields.py`

```python
"""game phase3 trade fields + single-open partial unique index

Revision ID: a1b2c3d4e5f6
Revises: 662687b086a3
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "662687b086a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("game_positions", sa.Column("entry_ratio", sa.Numeric(5, 4), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("size_amount", sa.Numeric(15, 2), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("leverage", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("game_trades", sa.Column("entry_ratio", sa.Numeric(5, 4), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.add_column("game_trades", sa.Column("had_stop_loss", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index(
        "uq_account_single_open",
        "game_positions",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )


def downgrade() -> None:
    op.drop_index("uq_account_single_open", table_name="game_positions")
    op.drop_column("game_trades", "had_stop_loss")
    op.drop_column("game_trades", "opened_at")
    op.drop_column("game_trades", "entry_ratio")
    op.drop_column("game_trades", "leverage")
    op.drop_column("game_trades", "size_amount")
    op.drop_column("game_positions", "entry_ratio")
```

- [ ] **Step 6: 마이그레이션 정합 확인**

Run: `uv run alembic check`
Expected: `No new upgrade operations detected.` (모델과 마이그레이션 일치)
문제 시: 모델 컬럼 정의와 마이그레이션 `add_column` 타입/nullable 을 일치시킨다.

- [ ] **Step 7: 커밋**

```bash
git add backend/shared/game_models.py backend/alembic/versions/a1b2c3d4e5f6_game_phase3_trade_fields.py backend/tests/test_order_engine.py
git commit -m "feat(game): Phase 3 스키마 — trade MBTI 필드 + 1계좌 1포지션 부분 유니크 인덱스"
```

---

### Task 4: 거래 세션 창 + 신선도 게이트 `market_clock.py`

거래 세션 창(KRX 정규장+애프터마켓) 판정 + 최신가 신선도 판정. `read_latest`는 Redis IO지만 나머지는 순수.

**Files:**
- Create: `backend/apps/trading_game/services/market_clock.py`
- Test: `backend/tests/test_order_engine.py` (게이트 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_order_engine.py` 에 추가

```python
from datetime import time as dtime
from apps.trading_game.services import market_clock


def test_parse_windows_default():
    w = market_clock.parse_windows(None)
    assert w == [(dtime(9, 0), dtime(15, 30)), (dtime(16, 0), dtime(20, 0))]


def test_parse_windows_custom():
    w = market_clock.parse_windows("09:00-12:00,13:00-15:00")
    assert w == [(dtime(9, 0), dtime(12, 0)), (dtime(13, 0), dtime(15, 0))]


def test_in_window_regular_session():
    now = datetime(2026, 10, 12, 10, 30, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is True


def test_in_window_excludes_premarket():
    now = datetime(2026, 10, 12, 8, 30, tzinfo=market_clock.KST)  # NXT 프리마켓
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is False


def test_in_window_aftermarket():
    now = datetime(2026, 10, 12, 18, 0, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is True


def test_in_window_night_closed():
    now = datetime(2026, 10, 12, 21, 0, tzinfo=market_clock.KST)
    assert market_clock.in_trading_window(now, market_clock.parse_windows(None)) is False


def test_price_fresh():
    assert market_clock.is_price_fresh(1000.0, 1005.0, 10) is True
    assert market_clock.is_price_fresh(1000.0, 1015.0, 10) is False
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py -k "window or fresh or parse_windows" -v`
Expected: FAIL — `No module named 'apps.trading_game.services.market_clock'`

- [ ] **Step 3: `market_clock.py` 구현**

```python
"""거래 세션 창 + 최신가 신선도 게이트.

거래시간을 코드에 하드코딩하지 않고 설정 데이터(TRADING_WINDOWS)로 둔다.
기본 = KRX 정규장(09:00-15:30) + 애프터마켓(16:00-20:00). NXT 프리마켓 제외.
"""
from __future__ import annotations

import json
import os
import time as _time
from datetime import datetime, time, timedelta, timezone

KST = timezone(timedelta(hours=9))
DEFAULT_WINDOWS = "09:00-15:30,16:00-20:00"


def parse_windows(raw: str | None) -> list[tuple[time, time]]:
    """'HH:MM-HH:MM,HH:MM-HH:MM' → [(time,time), ...]. None 이면 기본값."""
    spec = raw or DEFAULT_WINDOWS
    out: list[tuple[time, time]] = []
    for part in spec.split(","):
        start_s, end_s = part.strip().split("-")
        sh, sm = map(int, start_s.split(":"))
        eh, em = map(int, end_s.split(":"))
        out.append((time(sh, sm), time(eh, em)))
    return out


def load_windows() -> list[tuple[time, time]]:
    return parse_windows(os.getenv("TRADING_WINDOWS"))


def in_trading_window(now_kst: datetime, windows: list[tuple[time, time]]) -> bool:
    t = now_kst.timetz().replace(tzinfo=None)
    return any(start <= t <= end for start, end in windows)


def is_price_fresh(latest_ts: float, now_epoch: float, stale_seconds: int) -> bool:
    return (now_epoch - latest_ts) <= stale_seconds


async def read_latest(redis, ticker: str) -> dict | None:
    """stock:latest:{ticker} → {'price':..., 'ts':...} 또는 None."""
    raw = await redis.get(f"stock:latest:{ticker}")
    if raw is None:
        return None
    return json.loads(raw)


def now_kst() -> datetime:
    return datetime.now(KST)


def now_epoch() -> float:
    return _time.time()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -k "window or fresh or parse_windows" -v`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/market_clock.py backend/tests/test_order_engine.py
git commit -m "feat(game): 거래 세션 창 + 최신가 신선도 게이트(market_clock)"
```

---

### Task 5: DTO + 계좌 서비스 + 주문 엔진(진입/청산)

진입가는 라우터가 주입(엔진은 Redis 비의존, 테스트 용이). 청산은 조건부 UPDATE + rowcount.

**Files:**
- Create: `backend/apps/trading_game/schemas/__init__.py` (빈 파일)
- Create: `backend/apps/trading_game/schemas/game_dtos.py`
- Create: `backend/apps/trading_game/services/account_service.py`
- Create: `backend/apps/trading_game/services/order_engine.py`
- Test: `backend/tests/test_order_engine.py` (엔진 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_order_engine.py` 에 추가

```python
from apps.trading_game.services import account_service, order_engine


async def test_get_or_create_account_grants_initial_cash(session):
    acc = await _seed_account(session)
    # 이미 생성된 계좌는 그대로
    got = await account_service.get_or_create_account(session, acc.user_id, acc.season_id)
    assert got.id == acc.id
    assert got.cash_balance == INITIAL_CASH


async def test_open_position_deducts_cash_and_sets_tp_sl(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"),
        leverage=2, entry_price=Decimal("100"),
        sl_pct=Decimal("0.05"), tp_pct=Decimal("0.10"),
    )
    assert pos.size_amount == INITIAL_CASH * Decimal("0.5")
    assert pos.stop_loss_price == Decimal("95.00")
    assert pos.take_profit_price == Decimal("110.00")
    await session.refresh(acc)
    assert acc.cash_balance == INITIAL_CASH - pos.size_amount


async def test_open_position_rejects_below_minimum(session):
    acc = await _seed_account(session)
    # 잔고를 30만으로 낮춰 ratio 0.25 진입 시 size=75,000 < 최소 10만 → 거부 유도
    acc.cash_balance = Decimal("300000")
    await session.commit()
    with pytest.raises(order_engine.OrderError):
        await order_engine.open_position(
            session, account=acc, side="LONG", ratio=Decimal("0.25"),
            leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )  # 300,000 × 0.25 = 75,000 < 100,000 최소


async def test_close_position_returns_principal_plus_pnl(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    trade = await order_engine.close_position(
        session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL"
    )
    assert trade is not None
    assert trade.closed_reason == "MANUAL"
    assert trade.roi_pct == Decimal("9.97")  # +10% - 0.03
    await session.refresh(acc)
    assert acc.total_trades == 1
    assert acc.win_trades == 1  # pnl > 0


async def test_close_position_idempotent_on_already_closed(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    first = await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("110"), reason="MANUAL")
    second = await order_engine.close_position(session, position_id=pos.id, exit_price=Decimal("120"), reason="MANUAL")
    assert first is not None
    assert second is None  # 이미 CLOSED → no-op
    await session.refresh(acc)
    assert acc.total_trades == 1
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py -k "account or open_position or close_position" -v`
Expected: FAIL — `No module named 'apps.trading_game.services.account_service'`

- [ ] **Step 3: DTO 구현** — `backend/apps/trading_game/schemas/__init__.py`(빈 파일) + `backend/apps/trading_game/schemas/game_dtos.py`

```python
"""트레이딩 게임 REST/WS DTO."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class OrderRequest(BaseModel):
    season_id: int
    side: Literal["LONG", "SHORT"]
    ratio: Literal[0.25, 0.5, 1.0]
    leverage: Literal[1, 2, 5]
    stop_loss_pct: float | None = Field(default=None, gt=0, le=1)
    take_profit_pct: float | None = Field(default=None, gt=0, le=1)


class PositionResponse(BaseModel):
    id: str
    side: str
    entry_price: Decimal
    size_amount: Decimal
    leverage: int
    stop_loss_price: Decimal | None
    take_profit_price: Decimal | None
    status: str
    roi_pct: Decimal | None = None
    pnl_amount: Decimal | None = None


class AccountResponse(BaseModel):
    season_id: int
    cash_balance: Decimal
    total_asset: Decimal
    current_roi: Decimal
    total_trades: int
    win_trades: int
```

- [ ] **Step 4: 계좌 서비스 구현** — `backend/apps/trading_game/services/account_service.py`

```python
"""가상 계좌 조회/자동생성 + ACTIVE 시즌 조회."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GameSeason


async def get_active_season(db: AsyncSession) -> GameSeason | None:
    row = await db.execute(select(GameSeason).where(GameSeason.status == "ACTIVE"))
    return row.scalar_one_or_none()


def season_is_tradable(season: GameSeason) -> bool:
    if season.status != "ACTIVE":
        return False
    if season.end_at is None:
        return True
    return season.end_at > datetime.now(timezone.utc)


async def get_or_create_account(db: AsyncSession, user_id: int, season_id: int) -> GameAccount:
    row = await db.execute(
        select(GameAccount).where(
            GameAccount.user_id == user_id, GameAccount.season_id == season_id
        )
    )
    acc = row.scalar_one_or_none()
    if acc is not None:
        return acc
    acc = GameAccount(user_id=user_id, season_id=season_id)  # 기본값 INITIAL_CASH
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc
```

- [ ] **Step 5: 주문 엔진 구현** — `backend/apps/trading_game/services/order_engine.py`

```python
"""가상 주문 진입/청산. 진입가는 호출부가 주입(Redis 비의존)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameTrade
from apps.trading_game.services import pricing

MIN_ORDER_AMOUNT = Decimal("100000")  # 최소 주문 10만 원


class OrderError(Exception):
    """주문 거부(최소금액 미만, 잔고 부족 등). 라우터가 422 로 변환."""


async def open_position(
    db: AsyncSession,
    *,
    account: GameAccount,
    side: str,
    ratio: Decimal,
    leverage: int,
    entry_price: Decimal,
    sl_pct: Decimal | None,
    tp_pct: Decimal | None,
) -> GamePosition:
    size_amount = (account.cash_balance * ratio).quantize(Decimal("0.01"))
    if size_amount < MIN_ORDER_AMOUNT:
        raise OrderError(f"최소 주문 금액({MIN_ORDER_AMOUNT}) 미만입니다.")
    if size_amount > account.cash_balance:
        raise OrderError("잔고가 부족합니다.")

    sl_price, tp_price = pricing.tp_sl_prices(side, entry_price, sl_pct, tp_pct)
    pos = GamePosition(
        account_id=account.id,
        side=side,
        entry_price=entry_price,
        size_amount=size_amount,
        entry_ratio=ratio,
        leverage=leverage,
        stop_loss_price=sl_price,
        take_profit_price=tp_price,
        status="OPEN",
    )
    db.add(pos)
    # 잔고 차감은 SQL 증감으로 (read-modify-write 금지)
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == account.id)
        .values(cash_balance=GameAccount.cash_balance - size_amount)
    )
    await db.commit()
    await db.refresh(pos)
    return pos


async def close_position(
    db: AsyncSession, *, position_id: uuid.UUID, exit_price: Decimal, reason: str
) -> GameTrade | None:
    """조건부 청산. OPEN 인 경우에만 1건 처리(레이스/중복 방지). 아니면 None."""
    pos = await db.get(GamePosition, position_id)
    if pos is None or pos.status != "OPEN":
        return None

    # 조건부 상태 전이 — 이 UPDATE 가 1행을 바꾼 호출만 청산을 확정한다.
    res = await db.execute(
        update(GamePosition)
        .where(GamePosition.id == position_id, GamePosition.status == "OPEN")
        .values(status="CLOSED")
    )
    if res.rowcount != 1:
        await db.rollback()
        return None

    roi = pricing.compute_roi_pct(pos.side, pos.entry_price, exit_price, pos.leverage)
    pnl = pricing.compute_pnl(pos.size_amount, roi)
    return_amount = max(Decimal("0"), pos.size_amount + pnl)

    trade = GameTrade(
        account_id=pos.account_id,
        position_id=pos.id,
        side=pos.side,
        entry_price=pos.entry_price,
        exit_price=exit_price,
        pnl_amount=pnl,
        roi_pct=roi,
        closed_reason=reason,
        size_amount=pos.size_amount,
        leverage=pos.leverage,
        entry_ratio=pos.entry_ratio,
        opened_at=pos.created_at,
        had_stop_loss=pos.stop_loss_price is not None,
    )
    db.add(trade)
    win_inc = 1 if pnl > 0 else 0
    await db.execute(
        update(GameAccount)
        .where(GameAccount.id == pos.account_id)
        .values(
            cash_balance=GameAccount.cash_balance + return_amount,
            total_trades=GameAccount.total_trades + 1,
            win_trades=GameAccount.win_trades + win_inc,
        )
    )
    await db.commit()
    await db.refresh(trade)
    return trade
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -v`
Expected: PASS (전체)

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/schemas/__init__.py backend/apps/trading_game/schemas/game_dtos.py backend/apps/trading_game/services/account_service.py backend/apps/trading_game/services/order_engine.py backend/tests/test_order_engine.py
git commit -m "feat(game): 주문 엔진(진입/조건부 청산) + 계좌 서비스 + DTO"
```

---

### Task 6: 자동청산 서비스 `liquidation_service.py`

틱 가격으로 해당 ticker의 OPEN 포지션을 순회하며 TP/SL/마진콜 청산. `close_position` 재사용.

**Files:**
- Create: `backend/apps/trading_game/services/liquidation_service.py`
- Test: `backend/tests/test_order_engine.py` (자동청산 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_order_engine.py` 에 추가

```python
from apps.trading_game.services import liquidation_service


async def test_check_and_liquidate_triggers_take_profit(session):
    acc = await _seed_account(session)
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=None, tp_pct=Decimal("0.10"),
    )
    # TP=110 도달 → 자동청산
    trades = await liquidation_service.check_and_liquidate(session, "005930", Decimal("110"))
    assert len(trades) == 1
    assert trades[0].closed_reason == "TAKE_PROFIT"
    closed = await session.get(GamePosition, pos.id)
    assert closed.status == "CLOSED"


async def test_check_and_liquidate_skips_untriggered(session):
    acc = await _seed_account(session)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"),
        leverage=1, entry_price=Decimal("100"), sl_pct=Decimal("0.05"), tp_pct=Decimal("0.10"),
    )
    trades = await liquidation_service.check_and_liquidate(session, "005930", Decimal("101"))
    assert trades == []
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py -k "liquidate" -v`
Expected: FAIL — `No module named 'apps.trading_game.services.liquidation_service'`

- [ ] **Step 3: `liquidation_service.py` 구현**

```python
"""실시간 틱 수신 시 TP/SL/마진콜 자동청산 검사기."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade
from apps.trading_game.services import order_engine, pricing


async def _open_positions_for_ticker(db: AsyncSession, ticker: str) -> list[GamePosition]:
    rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .join(GameSeason, GameAccount.season_id == GameSeason.id)
        .where(GamePosition.status == "OPEN", GameSeason.ticker == ticker)
    )
    return list(rows.scalars().all())


async def check_and_liquidate(db: AsyncSession, ticker: str, price: Decimal) -> list[GameTrade]:
    """해당 ticker OPEN 포지션 중 청산조건 충족분을 청산하고 체결내역 목록 반환."""
    trades: list[GameTrade] = []
    for pos in await _open_positions_for_ticker(db, ticker):
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
            trades.append(trade)
    return trades
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -v`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/liquidation_service.py backend/tests/test_order_engine.py
git commit -m "feat(game): 틱 기반 TP/SL/마진콜 자동청산 서비스"
```

---

### Task 7: REST 라우터 `routers/orders.py`

진입 시 최신가 읽기 + 이중 게이트 통과 후 엔진 호출. 활성 포지션/계좌 조회.

**Files:**
- Create: `backend/apps/trading_game/routers/__init__.py` (빈 파일)
- Create: `backend/apps/trading_game/routers/orders.py`
- Create: `backend/apps/trading_game/deps.py` (Redis 의존성)

- [ ] **Step 1: Redis 의존성 모듈 작성** — `backend/apps/trading_game/deps.py`

```python
"""trading_game 공용 의존성 — Redis 클라이언트(요청 범위)."""
from __future__ import annotations

import os

import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STALE_SECONDS = int(os.getenv("STALE_SECONDS", "10"))

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis
```

- [ ] **Step 2: 라우터 작성** — `backend/apps/trading_game/routers/__init__.py`(빈 파일) + `backend/apps/trading_game/routers/orders.py`

```python
"""트레이딩 게임 REST — 주문 진입/수동청산/조회."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import GameAccount, GamePosition
from apps.trading_game import deps
from apps.trading_game.schemas.game_dtos import AccountResponse, OrderRequest, PositionResponse
from apps.trading_game.services import account_service, market_clock, order_engine, pricing

router = APIRouter(prefix="/api/game", tags=["trading-game"])


def _position_dto(pos: GamePosition, cur_price: Decimal | None = None) -> PositionResponse:
    roi = pnl = None
    if cur_price is not None:
        roi = pricing.compute_roi_pct(pos.side, pos.entry_price, cur_price, pos.leverage)
        pnl = pricing.compute_pnl(pos.size_amount, roi)
    return PositionResponse(
        id=str(pos.id), side=pos.side, entry_price=pos.entry_price,
        size_amount=pos.size_amount, leverage=pos.leverage,
        stop_loss_price=pos.stop_loss_price, take_profit_price=pos.take_profit_price,
        status=pos.status, roi_pct=roi, pnl_amount=pnl,
    )


@router.post("/orders", response_model=PositionResponse, status_code=status.HTTP_201_CREATED)
async def open_order(
    body: OrderRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    season = await account_service.get_active_season(db)
    if season is None or season.id != body.season_id or not account_service.season_is_tradable(season):
        raise HTTPException(status.HTTP_409_CONFLICT, "거래 가능한 ACTIVE 시즌이 아닙니다.")

    # 이중 게이트: 거래 세션 창 + 최신가 신선도
    redis = deps.get_redis()
    windows = market_clock.load_windows()
    if not market_clock.in_trading_window(market_clock.now_kst(), windows):
        raise HTTPException(status.HTTP_409_CONFLICT, "지금은 거래 시간이 아닙니다.")
    latest = await market_clock.read_latest(redis, season.ticker)
    if latest is None or not market_clock.is_price_fresh(
        float(latest["ts"]), market_clock.now_epoch(), deps.STALE_SECONDS
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")

    entry_price = Decimal(str(latest["price"]))
    account = await account_service.get_or_create_account(db, user.id, season.id)
    try:
        pos = await order_engine.open_position(
            db, account=account, side=body.side, ratio=Decimal(str(body.ratio)),
            leverage=body.leverage, entry_price=entry_price,
            sl_pct=Decimal(str(body.stop_loss_pct)) if body.stop_loss_pct else None,
            tp_pct=Decimal(str(body.take_profit_pct)) if body.take_profit_pct else None,
        )
    except order_engine.OrderError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 보유 중인 포지션이 있습니다.")
    return _position_dto(pos, entry_price)


@router.post("/positions/{position_id}/close", response_model=PositionResponse)
async def close_order(
    position_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pos = await db.get(GamePosition, uuid.UUID(position_id))
    if pos is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "포지션을 찾을 수 없습니다.")
    account = await db.get(GameAccount, pos.account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "본인 포지션이 아닙니다.")
    season = await account_service.get_active_season(db)
    redis = deps.get_redis()
    latest = await market_clock.read_latest(redis, season.ticker) if season else None
    if latest is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "시세 수신이 중단되었습니다.")
    exit_price = Decimal(str(latest["price"]))
    trade = await order_engine.close_position(
        db, position_id=pos.id, exit_price=exit_price, reason="MANUAL"
    )
    if trade is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 청산된 포지션입니다.")
    refreshed = await db.get(GamePosition, pos.id)
    return _position_dto(refreshed, exit_price)


@router.get("/positions/active", response_model=list[PositionResponse])
async def active_positions(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .where(
            GameAccount.user_id == user.id,
            GameAccount.season_id == season_id,
            GamePosition.status == "OPEN",
        )
    )
    season = await account_service.get_active_season(db)
    cur = None
    if season is not None:
        latest = await market_clock.read_latest(deps.get_redis(), season.ticker)
        if latest is not None:
            cur = Decimal(str(latest["price"]))
    return [_position_dto(p, cur) for p in rows.scalars().all()]


@router.get("/accounts/me", response_model=AccountResponse)
async def my_account(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    acc = await account_service.get_or_create_account(db, user.id, season_id)
    return AccountResponse(
        season_id=season_id, cash_balance=acc.cash_balance, total_asset=acc.total_asset,
        current_roi=acc.current_roi, total_trades=acc.total_trades, win_trades=acc.win_trades,
    )
```

- [ ] **Step 3: import 정합성 수동 확인(스모크)**

Run: `uv run python -c "from apps.trading_game.routers import orders; print('ok', orders.router.prefix)"`
Expected: `ok /api/game`

- [ ] **Step 4: 커밋**

```bash
git add backend/apps/trading_game/deps.py backend/apps/trading_game/routers/__init__.py backend/apps/trading_game/routers/orders.py
git commit -m "feat(game): REST 라우터(주문 진입/수동청산/조회) + 이중 게이트"
```

---

### Task 8: 틱 리스너 + WS 게이트웨이 + FastAPI 앱(main)

Redis 구독 리스너(lifespan)가 틱마다 자동청산 + WS Fan-out. WS 게이트웨이는 `?token=` 인증, 개인손익·시장심리 push.

**Files:**
- Create: `backend/apps/trading_game/services/connection_manager.py`
- Create: `backend/apps/trading_game/services/tick_listener.py`
- Create: `backend/apps/trading_game/routers/ws_gateway.py`
- Create: `backend/apps/trading_game/main.py`
- Test: `backend/tests/test_order_engine.py` (ConnectionManager 순수 로직 테스트)

- [ ] **Step 1: 실패하는 테스트 작성(시장심리 집계 순수 함수)** — `backend/tests/test_order_engine.py` 에 추가

```python
from apps.trading_game.services.connection_manager import sentiment_from_counts


def test_sentiment_ratio():
    s = sentiment_from_counts(long_count=65, short_count=35)
    assert s == {"long_pct": 65.0, "short_pct": 35.0}


def test_sentiment_zero_positions():
    s = sentiment_from_counts(long_count=0, short_count=0)
    assert s == {"long_pct": 0.0, "short_pct": 0.0}
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `uv run pytest tests/test_order_engine.py -k "sentiment" -v`
Expected: FAIL — `No module named 'apps.trading_game.services.connection_manager'`

- [ ] **Step 3: ConnectionManager 구현** — `backend/apps/trading_game/services/connection_manager.py`

```python
"""WS 연결 레지스트리 + Fan-out. 단일 워커 전제(인메모리)."""
from __future__ import annotations

import asyncio
import json

from fastapi import WebSocket

SEND_TIMEOUT = 2.0  # 느린 클라이언트 전송 타임아웃(초)


def sentiment_from_counts(long_count: int, short_count: int) -> dict:
    total = long_count + short_count
    if total == 0:
        return {"long_pct": 0.0, "short_pct": 0.0}
    return {
        "long_pct": round(long_count / total * 100, 1),
        "short_pct": round(short_count / total * 100, 1),
    }


class ConnectionManager:
    def __init__(self) -> None:
        # user_id -> set[WebSocket]
        self._conns: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conns.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._conns.get(user_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._conns.pop(user_id, None)

    def user_ids(self) -> list[int]:
        return list(self._conns.keys())

    async def _safe_send(self, user_id: int, ws: WebSocket, text: str) -> None:
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=SEND_TIMEOUT)
        except Exception:
            await self.disconnect(user_id, ws)

    async def broadcast(self, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        for user_id, conns in list(self._conns.items()):
            for ws in list(conns):
                await self._safe_send(user_id, ws, text)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        for ws in list(self._conns.get(user_id, set())):
            await self._safe_send(user_id, ws, text)


manager = ConnectionManager()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `uv run pytest tests/test_order_engine.py -k "sentiment" -v`
Expected: PASS (2 tests)

- [ ] **Step 5: 틱 리스너 구현** — `backend/apps/trading_game/services/tick_listener.py`

```python
"""Redis 구독 → 자동청산 + 개인손익 push. lifespan 백그라운드 태스크."""
from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal

import redis.asyncio as aioredis
from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameAccount, GamePosition, GameSeason
from apps.trading_game.services import account_service, liquidation_service, pricing
from apps.trading_game.services.connection_manager import manager

log = logging.getLogger("trading_game.listener")


async def _push_personal_pnl(ticker: str, price: Decimal) -> None:
    """현재 WS 접속 유저들의 보유 포지션 평가손익을 개인 push."""
    uids = manager.user_ids()
    if not uids:
        return
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(GamePosition, GameAccount.user_id)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(
                GamePosition.status == "OPEN",
                GameSeason.ticker == ticker,
                GameAccount.user_id.in_(uids),
            )
        )
        for pos, user_id in rows.all():
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            await manager.send_to_user(user_id, {
                "type": "position_pnl",
                "position_id": str(pos.id),
                "roi_pct": float(roi),
                "pnl_amount": float(pnl),
            })


async def _handle_tick(raw: str) -> None:
    tick = json.loads(raw)
    ticker = tick["ticker"]
    price = Decimal(str(tick["price"]))
    # 1) 자동청산
    async with AsyncSessionLocal() as db:
        await liquidation_service.check_and_liquidate(db, ticker, price)
    # 2) Fan-out(틱) + 개인손익
    await manager.broadcast({"type": "tick", "ticker": ticker, "price": tick["price"],
                             "timestamp": tick.get("timestamp")})
    await _push_personal_pnl(ticker, price)


async def run_listener(redis_url: str, stop: asyncio.Event) -> None:
    """ACTIVE 시즌 종목을 구독. 끊김 시 지수 백오프 재연결."""
    backoff = 1
    while not stop.is_set():
        try:
            async with AsyncSessionLocal() as db:
                season = await account_service.get_active_season(db)
            if season is None:
                log.warning("ACTIVE 시즌 없음 — 리스너 대기")
                await asyncio.wait_for(stop.wait(), timeout=10)
                continue
            redis = aioredis.from_url(redis_url, decode_responses=True)
            pubsub = redis.pubsub()
            await pubsub.subscribe(f"stock:tick:{season.ticker}")
            log.info("구독 시작 stock:tick:%s", season.ticker)
            backoff = 1
            async for msg in pubsub.listen():
                if stop.is_set():
                    break
                if msg.get("type") != "message":
                    continue
                try:
                    await _handle_tick(msg["data"])
                except Exception:
                    log.exception("틱 처리 실패 — skip")
            await pubsub.aclose()
            await redis.aclose()
        except asyncio.CancelledError:
            break
        except Exception:
            log.exception("리스너 오류 — %ss 후 재연결", backoff)
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 30)
    log.info("틱 리스너 종료")
```

- [ ] **Step 6: WS 게이트웨이 구현** — `backend/apps/trading_game/routers/ws_gateway.py`

```python
"""클라이언트 실시간 WebSocket — 틱/개인손익/시장심리."""
from __future__ import annotations

import asyncio
import contextlib

import jwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from shared.database import AsyncSessionLocal
from shared.security import decode_token
from shared.game_models import GameAccount, GamePosition, GameSeason
from apps.trading_game.services.connection_manager import manager, sentiment_from_counts

router = APIRouter()

SENTIMENT_INTERVAL = 5.0


async def _sentiment_loop(stop: asyncio.Event) -> None:
    while not stop.is_set():
        async with AsyncSessionLocal() as db:
            season = await db.execute(select(GameSeason).where(GameSeason.status == "ACTIVE"))
            season = season.scalar_one_or_none()
            counts = {"LONG": 0, "SHORT": 0}
            if season is not None:
                rows = await db.execute(
                    select(GamePosition.side, func.count())
                    .join(GameAccount, GamePosition.account_id == GameAccount.id)
                    .where(GamePosition.status == "OPEN", GameAccount.season_id == season.id)
                    .group_by(GamePosition.side)
                )
                for side, cnt in rows.all():
                    counts[side] = cnt
        payload = {"type": "sentiment", **sentiment_from_counts(counts["LONG"], counts["SHORT"])}
        await manager.broadcast(payload)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=SENTIMENT_INTERVAL)


@router.websocket("/ws/game/stream")
async def game_stream(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub", 0))
    except (jwt.PyJWTError, ValueError):
        await ws.close(code=4401)
        return
    await manager.connect(user_id, ws)
    try:
        while True:
            await ws.receive_text()  # 클라이언트 keep-alive(수신 무시)
    except WebSocketDisconnect:
        await manager.disconnect(user_id, ws)
```

- [ ] **Step 7: FastAPI 앱 구현** — `backend/apps/trading_game/main.py`

```python
"""트레이딩 게임 마이크로서비스 (FastAPI, Port 8003).

실행(단일 워커 필수 — 인메모리 WS 레지스트리/리스너):
    cd backend
    uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins
from apps.trading_game.routers import orders, ws_gateway
from apps.trading_game.services.tick_listener import run_listener

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    listener = asyncio.create_task(run_listener(REDIS_URL, stop))
    sentiment = asyncio.create_task(ws_gateway._sentiment_loop(stop))
    try:
        yield
    finally:
        stop.set()
        for task in (listener, sentiment):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="Stock App - Trading Game", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(orders.router)
app.include_router(ws_gateway.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "trading_game"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.trading_game.main:app", host="0.0.0.0", port=8003, reload=True)
```

- [ ] **Step 8: 앱 import 스모크 + 전체 테스트**

Run: `uv run python -c "from apps.trading_game.main import app; print('ok', len(app.routes))"`
Expected: `ok <N>` (예외 없이 로드)
Run: `uv run pytest tests/test_order_engine.py -v`
Expected: PASS (전체)

- [ ] **Step 9: 커밋**

```bash
git add backend/apps/trading_game/services/connection_manager.py backend/apps/trading_game/services/tick_listener.py backend/apps/trading_game/routers/ws_gateway.py backend/apps/trading_game/main.py backend/tests/test_order_engine.py
git commit -m "feat(game): 틱 리스너 + WS 게이트웨이(개인손익·시장심리) + 8003 앱"
```

---

### Task 9: 전체 회귀 + README 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 전체 테스트 회귀**

Run: `uv run pytest`
Expected: 전체 PASS (기존 + Phase 3 신규). 실패 시 해당 Task 로 돌아가 수정.

- [ ] **Step 2: 마이그레이션 최종 정합**

Run: `uv run alembic check`
Expected: `No new upgrade operations detected.`

- [ ] **Step 3: README 갱신** — `README.md` 의 백엔드 서비스 목록/실행 섹션에 trading_game(8003) 추가

아래 내용을 백엔드 서비스 실행 안내 부근에 추가:
```markdown
#### 트레이딩 게임 서비스 (Port 8003)

실시간 가상 주문/체결 엔진 + 클라이언트 WebSocket 게이트웨이.

> ⚠️ 반드시 단일 워커로 기동(인메모리 WS 레지스트리/틱 리스너):

    cd backend
    uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1

선행: Phase 2 수집 데몬(`apps.collector.run_game_ws`)이 돌아 `stock:tick:*`·`stock:latest:*` 를 채우고 있어야 주문 체결이 가능하다(장외엔 Mock: `MOCK_TICK_STREAM=true`).

환경변수:
- `REDIS_URL` (기본 `redis://localhost:6379/0`)
- `TRADING_WINDOWS` (기본 `09:00-15:30,16:00-20:00` KST — KRX 정규장+애프터마켓, NXT 프리마켓 제외)
- `STALE_SECONDS` (기본 `10` — 최신가가 이보다 오래되면 주문 거부)

에뮬레이터 검증 시: `adb reverse tcp:8003 tcp:8003` 추가.
```

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: README 에 트레이딩 게임 서비스(8003) 기동법·환경변수 반영"
```

---

## 최종 검증 (전체 완료 후)
- [ ] `uv run pytest` 전체 green.
- [ ] `uv run alembic check` in-sync.
- [ ] (수동, 선택) Mock 데몬 기동 → 8003 기동 → `POST /api/game/orders` 체결 → 틱마다 자동 TP/SL 동작 → `WS /ws/game/stream?token=` 로 틱·개인손익·시장심리 수신 확인.
- [ ] 최종 홀리스틱 코드리뷰(opus) 후 finishing-a-development-branch.

# 트레이딩 게임 Phase 4 — 랭킹 + 시즌 정산 + MBTI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실시간 랭킹(Redis ZSET Top100) + 시즌 정산 Celery 스케줄러(전액 강제청산→명예의전당→차기시즌) + Trading MBTI 분석을 구축한다.

**Architecture:** 순수 함수(mbti_analyzer, ranking_service.compute_live_roi)를 IO와 분리해 테스트 핵심으로 삼는다. 랭킹은 Redis ZSET이 실시간 소스(틱마다 라이브 ROI ZADD, 청산 시 실현 ROI 동기화). 정산은 매일 20:40 Celery가 "말일 도래한 ACTIVE 시즌"을 판별해 ClickHouse 당일 종가로 강제청산 후 hall_of_fame 박제·차기시즌 생성(멱등). order_engine은 Redis 비의존 유지 — 랭킹 ZADD는 호출부(tick_listener/orders)에서.

**Tech Stack:** Redis ZSET(redis.asyncio), Celery(crontab beat), async SQLAlchemy 2, ClickHouse(clickhouse-connect), pytest(+fakeredis dev dep). 스펙: `docs/superpowers/specs/2026-10-12-trading-game-phase4-ranking-settlement-design.md`.

**공통 규칙:**
- 모든 명령은 `backend/`에서 `uv run ...`. `asyncio_mode=auto`(no `@pytest.mark.asyncio`).
- 커밋 attribution 2줄:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- `git add -A`/`git add .` 금지 — Task의 명시 경로만. `.claude/`·`.serena/project.yml` 미커밋 유지.
- 금액·가격·비율은 `Decimal`. 틱/float는 `Decimal(str(x))` 변환.
- ecc GateGuard 훅이 Write/Edit 전 정당성(검색+사유)을 요구할 수 있음 — 막히면 Glob/Grep 1회 실행 후 사유 제시하고 재시도.

---

### Task 1: Trading MBTI 분류기 `mbti_analyzer.py`

**Files:**
- Create: `backend/apps/trading_game/services/mbti_analyzer.py`
- Test: `backend/tests/test_ranking_and_settlement.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_ranking_and_settlement.py` 신규:
```python
"""트레이딩 게임 Phase 4 — 랭킹/정산/MBTI 단위 테스트."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from apps.trading_game.services import mbti_analyzer


def _trade(side="LONG", pnl="100", ratio="0.5", had_sl=True, hold_sec=3600):
    """MBTI 분류 입력용 경량 스텁(실제 GameTrade 속성명과 동일)."""
    opened = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    closed = opened + timedelta(seconds=hold_sec)

    class _T:
        pass
    t = _T()
    t.side = side
    t.pnl_amount = Decimal(pnl)
    t.entry_ratio = Decimal(ratio)
    t.had_stop_loss = had_sl
    t.opened_at = opened
    t.closed_at = closed
    return t


def test_mbti_default_when_few_trades():
    assert mbti_analyzer.classify_mbti([_trade(), _trade()]) == "균형 탐색가"


def test_mbti_principled_stop_loss():
    # SL 설정 비율 100% (>=70%), 몰빵/초단타 아님
    trades = [_trade(ratio="0.25", had_sl=True, hold_sec=7200) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "냉철한 원칙주의자"


def test_mbti_reckless_allin_scalper():
    # 100% 몰빵 비율 >=50% + 평균 보유 <600s → 불나방(최우선)
    trades = [_trade(ratio="1.0", had_sl=True, hold_sec=60) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "불나방 트레이더"


def test_mbti_big_short():
    # SHORT 이익 기여 비중 >=60%
    trades = [
        _trade(side="SHORT", pnl="300", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "빅쇼트의 후예"


def test_mbti_bull_sniper():
    # LONG 승률 >=60%, SHORT 이익 비중 낮음, SL<70%
    trades = [
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="-50", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "황소 저격수"
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_ranking_and_settlement.py -v` → `ModuleNotFoundError: ... mbti_analyzer`.

- [ ] **Step 3: 구현** — `backend/apps/trading_game/services/mbti_analyzer.py`:
```python
"""Trading MBTI 분류(순수 함수). 입력: 유저의 청산 내역(GameTrade 유사 객체).

속성 사용: side, pnl_amount(Decimal), entry_ratio(Decimal), had_stop_loss(bool),
opened_at/closed_at(datetime). 거래 <3건이면 기본 라벨.
우선순위(첫 매치): 불나방 > 냉철한 원칙주의자 > 빅쇼트의 후예 > 황소 저격수 > 기본.
"""
from __future__ import annotations

from decimal import Decimal

DEFAULT_LABEL = "균형 탐색가"
MIN_TRADES = 3
ALLIN_RATIO = Decimal("1.0")
ALLIN_SHARE_THRESHOLD = 0.5
SCALP_HOLD_SECONDS = 600
STOP_LOSS_THRESHOLD = 0.7
SHORT_PROFIT_SHARE_THRESHOLD = 0.6
LONG_WINRATE_THRESHOLD = 0.6


def classify_mbti(trades: list) -> str:
    n = len(trades)
    if n < MIN_TRADES:
        return DEFAULT_LABEL

    allin = sum(1 for t in trades if t.entry_ratio == ALLIN_RATIO) / n
    avg_hold = sum((t.closed_at - t.opened_at).total_seconds() for t in trades) / n
    if allin >= ALLIN_SHARE_THRESHOLD and avg_hold < SCALP_HOLD_SECONDS:
        return "불나방 트레이더"

    sl_ratio = sum(1 for t in trades if t.had_stop_loss) / n
    if sl_ratio >= STOP_LOSS_THRESHOLD:
        return "냉철한 원칙주의자"

    total_profit = sum((t.pnl_amount for t in trades if t.pnl_amount > 0), Decimal("0"))
    short_profit = sum(
        (t.pnl_amount for t in trades if t.pnl_amount > 0 and t.side == "SHORT"),
        Decimal("0"),
    )
    if total_profit > 0 and short_profit / total_profit >= Decimal(str(SHORT_PROFIT_SHARE_THRESHOLD)):
        return "빅쇼트의 후예"

    longs = [t for t in trades if t.side == "LONG"]
    if longs:
        long_winrate = sum(1 for t in longs if t.pnl_amount > 0) / len(longs)
        if long_winrate >= LONG_WINRATE_THRESHOLD:
            return "황소 저격수"

    return DEFAULT_LABEL
```

- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_ranking_and_settlement.py -v` → 5 passed.

- [ ] **Step 5: 커밋**
```bash
git add backend/apps/trading_game/services/mbti_analyzer.py backend/tests/test_ranking_and_settlement.py
git commit -m "feat(game): Trading MBTI 분류기(순수 함수) + 단위테스트"
```

---

### Task 2: 랭킹 서비스 `ranking_service.py` + fakeredis dev 의존성

**Files:**
- Modify: `backend/pyproject.toml` (dev deps에 fakeredis 추가)
- Create: `backend/apps/trading_game/services/ranking_service.py`
- Test: `backend/tests/test_ranking_and_settlement.py` (추가)

- [ ] **Step 1: fakeredis 추가** — `backend/pyproject.toml`의 테스트 의존성 배열(현재 `"pytest>=9.1.1"`, `"pytest-asyncio>=0.24.0"`, `"aiosqlite>=0.20.0"` 포함)에 `"fakeredis>=2.26.0",` 한 줄 추가 후 `uv sync`.

- [ ] **Step 2: 실패 테스트 작성** — `test_ranking_and_settlement.py`에 추가:
```python
import pytest
from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import ranking_service


@pytest.fixture
async def redis():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


def test_compute_live_roi_flat_cash():
    # 포지션 없음 → total_asset = cash, roi=(cash-initial)/initial*100
    roi = ranking_service.compute_live_roi(
        Decimal("11000000"), None, Decimal("100"), Decimal("10000000")
    )
    assert roi == Decimal("10.0000")


def test_compute_live_roi_with_open_position():
    class _P:
        side = "LONG"
        entry_price = Decimal("100")
        size_amount = Decimal("5000000")
        leverage = 1
    # 현금 5M + 포지션(원금5M, +10%) → 평가익 반영, roi 양수(대략 +4.9%대)
    roi = ranking_service.compute_live_roi(
        Decimal("5000000"), _P(), Decimal("110"), Decimal("10000000")
    )
    assert roi > Decimal("4")


async def test_update_and_my_rank(redis):
    await ranking_service.update_rank(redis, 1, 10, Decimal("5.5"))
    await ranking_service.update_rank(redis, 1, 20, Decimal("12.3"))
    await ranking_service.update_rank(redis, 1, 30, Decimal("-2.0"))
    mine = await ranking_service.my_rank(redis, 1, 20)
    assert mine["rank"] == 1  # 12.3 최고 → 1위
    assert mine["roi_pct"] == 12.3
    assert mine["total"] == 3
    none_rank = await ranking_service.my_rank(redis, 1, 999)
    assert none_rank["rank"] is None
```

- [ ] **Step 3: 실패 확인** — `uv run pytest tests/test_ranking_and_settlement.py -k "live_roi or rank" -v` → ImportError/모듈 없음.

- [ ] **Step 4: 구현** — `backend/apps/trading_game/services/ranking_service.py`:
```python
"""실시간 랭킹(Redis ZSET) + 라이브 ROI 계산.

ZSET key: game:season:{id}:ranking, member=user_id(str), score=current_roi(%).
order_engine 은 Redis 비의존 유지 — ZADD 는 호출부(tick_listener/orders)에서 이 서비스로.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount
from apps.trading_game.services import pricing

_PCT_Q = Decimal("0.0001")


def ranking_key(season_id: int) -> str:
    return f"game:season:{season_id}:ranking"


def compute_live_roi(cash_balance: Decimal, open_pos, price: Decimal, initial_cash: Decimal) -> Decimal:
    """보유 포지션 미실현 평가 반영 ROI(%). open_pos=None 이면 현금만."""
    total_asset = cash_balance
    if open_pos is not None:
        roi = pricing.compute_roi_pct(open_pos.side, open_pos.entry_price, price, open_pos.leverage)
        pnl = pricing.compute_pnl(open_pos.size_amount, roi)
        if pnl < -open_pos.size_amount:  # 원금손실 클램프(엔진과 동일)
            pnl = -open_pos.size_amount
        total_asset = cash_balance + open_pos.size_amount + pnl
    roi_pct = (total_asset - initial_cash) / initial_cash * Decimal("100")
    return roi_pct.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


async def update_rank(redis, season_id: int, user_id: int, roi: Decimal) -> None:
    await redis.zadd(ranking_key(season_id), {str(user_id): float(roi)})


async def sync_account_rank(redis, db: AsyncSession, account_id) -> None:
    """계좌의 현재 current_roi 를 랭킹에 반영(청산 후 호출)."""
    acc = await db.get(GameAccount, account_id)
    if acc is not None:
        await update_rank(redis, acc.season_id, acc.user_id, acc.current_roi)


async def my_rank(redis, season_id: int, user_id: int) -> dict:
    key = ranking_key(season_id)
    rank = await redis.zrevrank(key, str(user_id))
    total = await redis.zcard(key)
    if rank is None:
        return {"rank": None, "roi_pct": None, "percentile": None, "total": total}
    score = await redis.zscore(key, str(user_id))
    return {
        "rank": rank + 1,
        "roi_pct": float(score) if score is not None else None,
        "percentile": round((rank + 1) / total * 100, 1) if total else None,
        "total": total,
    }


async def top_leaderboard(redis, db: AsyncSession, season_id: int, limit: int = 100) -> list[dict]:
    key = ranking_key(season_id)
    pairs = await redis.zrevrange(key, 0, limit - 1, withscores=True)
    if not pairs:
        return []
    user_ids = [int(uid) for uid, _ in pairs]
    rows = await db.execute(
        select(GameAccount, User.nickname)
        .join(User, GameAccount.user_id == User.id)
        .where(GameAccount.season_id == season_id, GameAccount.user_id.in_(user_ids))
    )
    by_uid = {acc.user_id: (acc, nick) for acc, nick in rows.all()}
    out = []
    for i, (uid, score) in enumerate(pairs):
        acc_nick = by_uid.get(int(uid))
        acc = acc_nick[0] if acc_nick else None
        nick = acc_nick[1] if acc_nick else None
        win_rate = 0.0
        total_asset = None
        if acc is not None:
            total_asset = float(acc.total_asset)
            if acc.total_trades:
                win_rate = round(acc.win_trades / acc.total_trades * 100, 1)
        out.append({
            "rank": i + 1, "user_id": int(uid), "nickname": nick,
            "roi_pct": float(score), "total_asset": total_asset, "win_rate": win_rate,
        })
    return out
```

- [ ] **Step 5: 통과 확인** — `uv run pytest tests/test_ranking_and_settlement.py -k "live_roi or rank" -v` → PASS. 전체 파일 green.

- [ ] **Step 6: 커밋**
```bash
git add backend/pyproject.toml backend/uv.lock backend/apps/trading_game/services/ranking_service.py backend/tests/test_ranking_and_settlement.py
git commit -m "feat(game): 랭킹 서비스(ZSET)+라이브 ROI + fakeredis 테스트 의존성"
```

---

### Task 3: 시즌 정산 `settlement.py`

**Files:**
- Create: `backend/apps/trading_game/services/settlement.py`
- Test: `backend/tests/test_ranking_and_settlement.py` (추가)

- [ ] **Step 1: 실패 테스트 작성** — `test_ranking_and_settlement.py`에 추가(aiosqlite 세션 하니스 포함):
```python
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import (
    GameAccount, GamePosition, GameSeason, HallOfFame, INITIAL_CASH,
)
from apps.trading_game.services import settlement


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed_season_with_players(db, end_at):
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc), end_at=end_at, status="ACTIVE",
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    for i in range(3):
        u = User(nickname=f"p{i}", role=UserRole.FREE, is_active=True)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        acc = GameAccount(user_id=u.id, season_id=season.id, cash_balance=Decimal("0"))
        db.add(acc)
        await db.commit()
        await db.refresh(acc)
        db.add(GamePosition(
            account_id=acc.id, side="LONG", entry_price=Decimal("100"),
            size_amount=INITIAL_CASH, entry_ratio=Decimal("1.0"), leverage=1, status="OPEN",
        ))
        await db.commit()
    return season


async def test_settlement_closes_archives_and_rolls_over(db):
    past = datetime(2026, 10, 31, 11, 0, tzinfo=timezone.utc)  # now 이전
    season = await _seed_season_with_players(db, end_at=past)
    result = await settlement.settle_due_season(
        db, redis=None, close_price_provider=lambda t: Decimal("110")
    )
    assert result is not None
    opens = (await db.execute(select(GamePosition).where(GamePosition.status == "OPEN"))).scalars().all()
    assert opens == []
    hof = (await db.execute(select(HallOfFame).where(HallOfFame.season_id == season.id))).scalars().all()
    assert len(hof) == 3
    assert all(h.trading_mbti for h in hof)
    await db.refresh(season)
    assert season.status == "FINISHED"
    nxt = (await db.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert nxt.status == "ACTIVE" and nxt.ticker == "005930"


async def test_settlement_idempotent(db):
    past = datetime(2026, 10, 31, 11, 0, tzinfo=timezone.utc)
    await _seed_season_with_players(db, end_at=past)
    await settlement.settle_due_season(db, None, lambda t: Decimal("110"))
    second = await settlement.settle_due_season(db, None, lambda t: Decimal("110"))
    assert second is None  # 이미 FINISHED → 재정산 안 함
    seasons = (await db.execute(select(GameSeason))).scalars().all()
    assert len(seasons) == 2  # 차기시즌 중복 생성 없음


async def test_settlement_skips_open_ended(db):
    await _seed_season_with_players(db, end_at=None)  # 무기한
    assert await settlement.settle_due_season(db, None, lambda t: Decimal("110")) is None
```

- [ ] **Step 2: 실패 확인** — `uv run pytest tests/test_ranking_and_settlement.py -k "settlement" -v` → 모듈 없음.

- [ ] **Step 3: 구현** — `backend/apps/trading_game/services/settlement.py`:
```python
"""시즌 정산 파이프라인(멱등). 말일 판별 → 전액청산→박제→차기시즌."""
from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import (
    GameAccount, GamePosition, GameSeason, GameTrade, HallOfFame, INITIAL_CASH,
)
from apps.trading_game.services import account_service, mbti_analyzer, order_engine

log = logging.getLogger("trading_game.settlement")
KST = timezone(timedelta(hours=9))


def next_month_bounds(ref: datetime) -> tuple[datetime, datetime]:
    """ref 기준 '다음 달' 시작(1일 09:00 KST)·종료(말일 20:00 KST)."""
    y, m = ref.year, ref.month
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    start = datetime(ny, nm, 1, 9, 0, tzinfo=KST)
    last_day = calendar.monthrange(ny, nm)[1]
    end = datetime(ny, nm, last_day, 20, 0, tzinfo=KST)
    return start, end


async def settle_due_season(db: AsyncSession, redis, close_price_provider) -> dict | None:
    season = await account_service.get_active_season(db)
    if season is None or season.end_at is None:
        return None
    now = datetime.now(timezone.utc)
    end_at = season.end_at if season.end_at.tzinfo else season.end_at.replace(tzinfo=timezone.utc)
    if now < end_at or season.status != "ACTIVE":
        return None

    price = close_price_provider(season.ticker)
    if price is None:
        log.warning("정산 중단 — 종가 미확보(ticker=%s)", season.ticker)
        return None
    price = Decimal(str(price))

    # 1) 전액 강제청산
    open_rows = await db.execute(
        select(GamePosition)
        .join(GameAccount, GamePosition.account_id == GameAccount.id)
        .where(GamePosition.status == "OPEN", GameAccount.season_id == season.id)
    )
    closed = 0
    for pos in open_rows.scalars().all():
        trade = await order_engine.close_position(
            db, position_id=pos.id, exit_price=price, reason="SEASON_END"
        )
        if trade is not None:
            closed += 1

    # 2~3) 최종순위 → 명예의 전당(상위 100)
    acc_rows = await db.execute(
        select(GameAccount, User.nickname)
        .join(User, GameAccount.user_id == User.id)
        .where(GameAccount.season_id == season.id)
        .order_by(GameAccount.current_roi.desc())
        .limit(100)
    )
    archived = 0
    for rank, (acc, nick) in enumerate(acc_rows.all(), start=1):
        exists = await db.execute(
            select(HallOfFame).where(
                HallOfFame.season_id == season.id, HallOfFame.user_id == acc.user_id
            )
        )
        if exists.scalar_one_or_none() is not None:
            continue
        trades = (await db.execute(
            select(GameTrade).where(GameTrade.account_id == acc.id)
        )).scalars().all()
        win_rate = round(acc.win_trades / acc.total_trades * 100, 2) if acc.total_trades else 0
        db.add(HallOfFame(
            season_id=season.id, rank=rank, user_id=acc.user_id, user_nickname=nick,
            final_roi=acc.current_roi, final_asset=acc.total_asset,
            win_rate=Decimal(str(win_rate)), trading_mbti=mbti_analyzer.classify_mbti(trades),
        ))
        archived += 1
    await db.commit()

    # 4) 시즌 FINISHED
    season.status = "FINISHED"
    await db.commit()

    # 5) 차기 시즌 생성(멱등: season_number 중복이면 skip)
    next_num = season.season_number + 1
    dup = await db.execute(select(GameSeason).where(GameSeason.season_number == next_num))
    next_season_num = None
    if dup.scalar_one_or_none() is None:
        start, end = next_month_bounds(end_at.astimezone(KST))
        db.add(GameSeason(
            season_number=next_num, ticker=season.ticker, stock_name=season.stock_name,
            start_at=start, end_at=end, status="ACTIVE", initial_cash=INITIAL_CASH,
        ))
        await db.commit()
        next_season_num = next_num

    return {"settled_season": season.season_number, "closed": closed,
            "archived": archived, "next_season": next_season_num}
```

- [ ] **Step 4: 통과 확인** — `uv run pytest tests/test_ranking_and_settlement.py -k "settlement" -v` → 3 passed. 전체 파일 green.

- [ ] **Step 5: 커밋**
```bash
git add backend/apps/trading_game/services/settlement.py backend/tests/test_ranking_and_settlement.py
git commit -m "feat(game): 시즌 정산 파이프라인(전액청산→명예의전당→차기시즌, 멱등)"
```

---

### Task 4: 랭킹/명예의전당 REST 라우터 + 8003 마운트

**Files:**
- Create: `backend/apps/trading_game/routers/leaderboard.py`
- Modify: `backend/apps/trading_game/main.py` (라우터 include)

- [ ] **Step 1: 라우터 작성** — `backend/apps/trading_game/routers/leaderboard.py`:
```python
"""트레이딩 게임 랭킹/명예의전당 REST."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import User
from shared.game_models import HallOfFame
from apps.trading_game import deps
from apps.trading_game.services import ranking_service

router = APIRouter(prefix="/api/game", tags=["trading-game-ranking"])


@router.get("/seasons/{season_id}/leaderboard")
async def leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    return await ranking_service.top_leaderboard(deps.get_redis(), db, season_id, limit=100)


@router.get("/seasons/{season_id}/my-rank")
async def my_rank(
    season_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ranking_service.my_rank(deps.get_redis(), season_id, user.id)


@router.get("/hall-of-fame")
async def hall_of_fame(season_id: int | None = Query(default=None), db: AsyncSession = Depends(get_db)):
    stmt = select(HallOfFame)
    if season_id is not None:
        stmt = stmt.where(HallOfFame.season_id == season_id)
    stmt = stmt.order_by(HallOfFame.season_id.desc(), HallOfFame.rank.asc()).limit(300)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {"season_id": h.season_id, "rank": h.rank, "nickname": h.user_nickname,
         "final_roi": float(h.final_roi), "final_asset": float(h.final_asset),
         "win_rate": float(h.win_rate), "trading_mbti": h.trading_mbti}
        for h in rows
    ]
```

- [ ] **Step 2: main 마운트** — `backend/apps/trading_game/main.py`:
  - import 줄 `from apps.trading_game.routers import orders, ws_gateway` → `from apps.trading_game.routers import leaderboard, orders, ws_gateway`
  - `app.include_router(ws_gateway.router)` 다음 줄에 `app.include_router(leaderboard.router)` 추가.

- [ ] **Step 3: 스모크** — `uv run python -c "from apps.trading_game.main import app; print('ok', len(app.routes))"` → 예외 없이 라우트 증가(기존 7 → 10).
- [ ] **Step 4: 회귀** — `uv run pytest tests/test_ranking_and_settlement.py -q` → green.

- [ ] **Step 5: 커밋**
```bash
git add backend/apps/trading_game/routers/leaderboard.py backend/apps/trading_game/main.py
git commit -m "feat(game): 랭킹/명예의전당 REST 라우터 + 8003 마운트"
```

---

### Task 5: Celery 정산 태스크 + beat(매일 20:40) + ClickHouse 종가 provider

**Files:**
- Create: `backend/apps/collector/tasks/settle_season.py`
- Modify: `backend/apps/collector/celery_app.py` (beat 스케줄)

- [ ] **Step 1: 종가 provider + 태스크 작성** — `backend/apps/collector/tasks/settle_season.py`:
```python
"""시즌 정산 Celery 태스크(매일 20:40 — 말일 도래 시 정산)."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, timedelta
from decimal import Decimal

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal
from apps.collector.celery_app import celery_app
from apps.stock_api.services.clickhouse_source import get_candles
from apps.trading_game.services import settlement

log = logging.getLogger("trading_game.settle_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def clickhouse_close_price(ticker: str) -> Decimal | None:
    """최근 7일 범위의 마지막 종가(FINAL) → Decimal. 없으면 None."""
    end = date.today()
    start = end - timedelta(days=7)
    candles = get_candles(ticker, start.isoformat(), end.isoformat())
    if not candles:
        return None
    return Decimal(str(candles[-1].close))


async def _run() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await settlement.settle_due_season(db, redis, clickhouse_close_price)
    finally:
        await redis.aclose()


@celery_app.task(name="settle_trading_season")
def settle_trading_season() -> dict | None:
    result = asyncio.run(_run())
    log.info("시즌 정산 결과: %s", result)
    return result
```

- [ ] **Step 2: beat 등록** — `backend/apps/collector/celery_app.py`의 `celery_app.conf.beat_schedule` dict에 항목 추가(기존 20:30 수집 항목 옆):
```python
    "settle-trading-season": {
        "task": "settle_trading_season",
        "schedule": crontab(hour=20, minute=40),
    },
```

- [ ] **Step 3: import 스모크** — `uv run python -c "import apps.collector.tasks.settle_season as s; print('ok', s.settle_trading_season.name)"` → `ok settle_trading_season`.
- [ ] **Step 4: beat 등록 확인** — `uv run python -c "from apps.collector.celery_app import celery_app; print('settle-trading-season' in celery_app.conf.beat_schedule)"` → `True`.

- [ ] **Step 5: 커밋**
```bash
git add backend/apps/collector/tasks/settle_season.py backend/apps/collector/celery_app.py
git commit -m "feat(game): 시즌 정산 Celery 태스크 + beat(매일 20:40, ClickHouse 종가)"
```

---

### Task 6: 랭킹 ZADD 연결(tick_listener 라이브 + 청산 동기화)

**Files:**
- Modify: `backend/apps/trading_game/services/tick_listener.py`
- Modify: `backend/apps/trading_game/routers/orders.py`

- [ ] **Step 1: tick_listener 수정** —
  - import 추가: `from apps.trading_game import deps`, `from apps.trading_game.services import ranking_service`, 그리고 `from shared.game_models import ...`에 `INITIAL_CASH` 추가.
  - `_handle_tick`에서 청산 후 각 계좌 동기화:
```python
    async with AsyncSessionLocal() as db:
        trades = await liquidation_service.check_and_liquidate(db, ticker, price)
        for tr in trades:
            await ranking_service.sync_account_rank(deps.get_redis(), db, tr.account_id)
```
  - `_push_personal_pnl` 쿼리를 `(GamePosition, GameAccount)`로 바꾸고 보유자별 라이브 ROI ZADD 추가:
```python
        rows = await db.execute(
            select(GamePosition, GameAccount)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(
                GamePosition.status == "OPEN",
                GameSeason.ticker == ticker,
                GameSeason.status == "ACTIVE",
                GameAccount.user_id.in_(uids),
            )
        )
        for pos, acc in rows.all():
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            await manager.send_to_user(acc.user_id, {
                "type": "position_pnl", "position_id": str(pos.id),
                "roi_pct": float(roi), "pnl_amount": float(pnl),
            })
            live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, INITIAL_CASH)
            await ranking_service.update_rank(deps.get_redis(), acc.season_id, acc.user_id, live)
```

- [ ] **Step 2: orders.py close_order 동기화** — `close_order`에서 `trade = await order_engine.close_position(...)` 후 `trade is None` 체크를 통과한 뒤(= 청산 성공) `refreshed` 반환 직전에:
```python
    await ranking_service.sync_account_rank(deps.get_redis(), db, account.id)
```
  - import: 기존 `from apps.trading_game.services import account_service, market_clock, order_engine, pricing`에 `ranking_service` 추가.

- [ ] **Step 3: 스모크 + 회귀** —
  - `uv run python -c "from apps.trading_game.main import app; print('ok', len(app.routes))"` → 예외 없음.
  - `uv run pytest -q` → 전체 green(회귀 없음).

- [ ] **Step 4: 커밋**
```bash
git add backend/apps/trading_game/services/tick_listener.py backend/apps/trading_game/routers/orders.py
git commit -m "feat(game): 랭킹 ZADD 연결 — 틱 라이브 ROI + 청산 후 실현 ROI 동기화"
```

---

## 최종 검증 (전체 완료 후)
- [ ] `uv run pytest` 전체 green.
- [ ] 8003 앱 로드 + 라우트 수 증가(leaderboard 3개).
- [ ] beat에 `settle-trading-season`(20:40) 등록 확인.
- [ ] 정산 멱등성 테스트 green.
- [ ] 최종 홀리스틱 리뷰(opus) 후 finishing-a-development-branch.

## Self-Review 메모(스펙 대비)
- §2.1 월간/무기한 제외 → Task3(`end_at None` skip)+`next_month_bounds`. §2.2 20:40 beat → Task5. §2.3 ClickHouse 종가 → Task5 provider. §2.4/2.5 라이브 랭킹·compute_live_roi → Task2+Task6. §3.1 랭킹 서비스 → Task2. §3.2 MBTI → Task1. §3.3 정산 → Task3. §3.4 REST → Task4. §3.5 Celery → Task5. §3.6 ZADD 연결 → Task6. §6 테스트 → 각 Task. 전 항목 커버.

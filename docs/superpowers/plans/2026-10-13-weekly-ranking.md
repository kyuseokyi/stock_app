# 주간 랭킹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트레이딩 게임에 주간 랭킹(월 09:00 시작, 시즌 경계로 잘림)·주간 Top 10 기록·1~3위 자동 보상·보상 토스트를 추가한다.

**Architecture:** 주간 ROI 는 `(1+roi)/(1+base)−1`(grant_cash 가 ROI 를 보존하므로 NAV 비율). base 는 그 주 첫 `update_rank` 때 시즌 ZSET 의 갱신 전 점수를 `HSETNX` 로 기록. 주간 ZSET 은 기존 `update_rank` 한 곳에서 함께 갱신. 마감은 Celery beat(월 08:50) + 시즌 정산 직전(보상 없음). 결과는 PG `weekly_ranking_results`.

**Tech Stack:** FastAPI·SQLAlchemy async·Alembic·Redis(fakeredis 테스트)·Celery / React+Vite+Tailwind(web_client) / Expo RN + Unistyles(mobile)

**스펙:** `docs/superpowers/specs/2026-10-13-weekly-ranking-design.md`

**공통 규칙(모든 태스크):**
- 백엔드 명령은 `cd backend && conda run -n stock_app uv run pytest ...` 형태로 실행.
- `git add -A`/`git add .` 금지 — 명시 경로만. `.claude/`, `.serena/project.yml` 커밋 금지. 브랜치 `dev`.
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 기존 API 응답(`leaderboard`, `my-rank`, `accounts/me`) 구조 변경 금지.
- **순환 import 주의:** `reward_service` 가 `ranking_service` 를 import 한다. 따라서 `ranking_service` 가 import 하는 `weekly_ranking.py` 는 순수 모듈(서비스 import 금지)로 두고, DB·보상을 쓰는 로직은 `weekly_service.py` 에 둔다.

---

## File Structure
- Create `backend/apps/trading_game/services/weekly_ranking.py` — 순수: 주 경계·주간 ROI·Redis 키·상수.
- Modify `backend/apps/trading_game/services/ranking_service.py` — `update_rank(..., season_window=, now=)` 주간 갱신, `sync_account_rank` 시즌 창 전달.
- Modify `backend/apps/trading_game/services/tick_listener.py` — `_push_personal_pnl` 이 시즌 창 전달.
- Modify `backend/shared/game_models.py` — `WeeklyRankingResult`.
- Create `backend/alembic/versions/c9d0e1f2a3b4_weekly_ranking_results.py`.
- Create `backend/apps/trading_game/services/weekly_service.py` — close_week·조회·미확인 보상·ack.
- Modify `backend/apps/trading_game/services/settlement.py` — 시즌 ZSET 삭제 전 마지막 주 기록.
- Create `backend/apps/collector/tasks/weekly_close.py`, Modify `backend/apps/collector/celery_app.py` — beat 월 08:50.
- Modify `backend/apps/trading_game/routers/leaderboard.py` — 5개 엔드포인트.
- Tests: `backend/tests/test_weekly_ranking.py`(신규, 전 백엔드 태스크 공용).
- web_client: `src/types/game.ts`, `src/api/game.ts`, `src/lib/format.ts`, `src/store/tradingGame.ts`, `src/components/game/LeaderboardModal.tsx`, Create `src/components/game/WeeklyRankingTab.tsx`.
- mobile: `src/features/game/types.ts`, `api.ts`, `lib/weekly.ts`(+`weekly.test.ts`), `store.ts`, `components/leaderboard-sheet.tsx`, Create `components/weekly-ranking-tab.tsx`.
- Docs: `README.md`, `docs/ROADMAP.md`(존재 시), `docs/pending_checks.md`.

---

### Task 1: 순수 함수 `weekly_ranking.py`

**Files:**
- Create: `backend/apps/trading_game/services/weekly_ranking.py`
- Test: `backend/tests/test_weekly_ranking.py`

- [ ] **Step 1: 실패 테스트 작성** (`backend/tests/test_weekly_ranking.py` 신규)

```python
"""주간 랭킹 — 순수 함수·랭킹 갱신·마감·API 테스트."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from apps.trading_game.services import weekly_ranking as wr

KST = timezone(timedelta(hours=9))
S_START = datetime(2026, 10, 1, 9, 0, tzinfo=KST)   # 목요일
S_END = datetime(2026, 10, 31, 20, 0, tzinfo=KST)   # 토요일


def k(d, h, m=0):
    return datetime(2026, 10, d, h, m, tzinfo=KST)


@pytest.mark.parametrize("now, week_id, start, end", [
    (k(14, 12), date(2026, 10, 12), k(12, 9), k(19, 9)),        # 수요일
    (k(12, 9), date(2026, 10, 12), k(12, 9), k(19, 9)),         # 월 09:00 정각 = 새 주
    (k(12, 8, 59), date(2026, 10, 5), k(5, 9), k(12, 9)),       # 월 08:59 = 지난주
    (k(2, 10), date(2026, 9, 28), S_START, k(5, 9)),            # 시즌 시작으로 잘림
    (k(30, 15), date(2026, 10, 26), k(26, 9), S_END),           # 시즌 종료로 잘림
])
def test_week_bounds(now, week_id, start, end):
    assert wr.week_bounds(now, S_START, S_END) == (week_id, start, end)


def test_week_bounds_naive_season_is_utc_and_open_end():
    naive_start = datetime(2026, 10, 1, 0, 0)  # SQLite 는 naive 로 돌려줌 → UTC 로 해석
    wid, s, e = wr.week_bounds(k(14, 12), naive_start, None)
    assert wid == date(2026, 10, 12) and s == k(12, 9) and e == k(19, 9)


@pytest.mark.parametrize("roi, base, expected", [
    (Decimal("10"), Decimal("0"), Decimal("10.0000")),
    (Decimal("21"), Decimal("10"), Decimal("10.0000")),      # 1.21/1.10
    (Decimal("-10"), Decimal("20"), Decimal("-25.0000")),    # 0.9/1.2
    (Decimal("5"), Decimal("-100"), Decimal("0")),           # 분모 0 방어
])
def test_weekly_roi(roi, base, expected):
    assert wr.weekly_roi(roi, base) == expected


def test_keys_and_constants():
    assert wr.week_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:ranking"
    assert wr.base_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:base"
    assert wr.REWARDS == {1: Decimal("500000"), 2: Decimal("300000"), 3: Decimal("200000")}
    assert wr.ARCHIVE_TOP == 10
    assert wr.WEEK_TTL_SEC == 21 * 24 * 3600
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q`
Expected: FAIL — `ImportError: cannot import name 'weekly_ranking'`

- [ ] **Step 3: 구현** (`backend/apps/trading_game/services/weekly_ranking.py`)

```python
"""주간 랭킹 순수 로직 — 주 경계(월 09:00 KST, 시즌 창으로 잘림)·주간 ROI·Redis 키.

DB/보상 서비스를 import 하지 않는다(ranking_service ← reward_service 순환 방지).
주간 ROI 는 NAV 비율: grant_cash 가 ROI 를 보존하므로 (1+roi)/(1+base) 는 보상과 무관하다.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

KST = timezone(timedelta(hours=9))
WEEK_START = time(9, 0)
REWARDS: dict[int, Decimal] = {1: Decimal("500000"), 2: Decimal("300000"), 3: Decimal("200000")}
ARCHIVE_TOP = 10
WEEK_TTL_SEC = 21 * 24 * 3600
_PCT_Q = Decimal("0.0001")


def aware(dt: datetime) -> datetime:
    """naive(SQLite) 는 UTC 로 해석 — settlement 와 같은 규칙."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def week_bounds(
    now: datetime, season_start: datetime, season_end: datetime | None,
) -> tuple[date, datetime, datetime]:
    """(week_id=잘리기 전 주 시작 월요일, 잘린 시작, 잘린 끝). 반환 시각은 KST aware."""
    k = aware(now).astimezone(KST)
    monday = (k - timedelta(days=k.weekday())).date()
    start = datetime.combine(monday, WEEK_START, tzinfo=KST)
    if k < start:
        start -= timedelta(days=7)
    end = start + timedelta(days=7)
    s = max(start, aware(season_start).astimezone(KST))
    e = min(end, aware(season_end).astimezone(KST)) if season_end is not None else end
    return start.date(), s, e


def weekly_roi(roi: Decimal, base: Decimal) -> Decimal:
    denom = Decimal("1") + base / Decimal("100")
    if denom <= 0:
        return Decimal("0")
    val = ((Decimal("1") + roi / Decimal("100")) / denom - Decimal("1")) * Decimal("100")
    return val.quantize(_PCT_Q, rounding=ROUND_HALF_UP)


def week_key(season_id: int, week_id: date) -> str:
    return f"game:season:{season_id}:week:{week_id.isoformat()}:ranking"


def base_key(season_id: int, week_id: date) -> str:
    return f"game:season:{season_id}:week:{week_id.isoformat()}:base"
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q`
Expected: 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/weekly_ranking.py backend/tests/test_weekly_ranking.py
git commit -m "feat(game): 주간 랭킹 주 경계·주간 ROI 순수 함수"
```

---

### Task 2: `update_rank` 주간 갱신 + 호출부 시즌 창 전달

**Files:**
- Modify: `backend/apps/trading_game/services/ranking_service.py`
- Modify: `backend/apps/trading_game/services/tick_listener.py` (`_push_personal_pnl`)
- Test: `backend/tests/test_weekly_ranking.py`

- [ ] **Step 1: 실패 테스트 추가** (파일 끝에 append)

```python
# ---------------------------------------------------------------- update_rank 주간 갱신
from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import ranking_service as rs

W = date(2026, 10, 12)
WIN = (S_START, S_END)


def _r():
    return fake_aioredis.FakeRedis(decode_responses=True)


async def test_update_rank_first_update_uses_previous_season_score_as_base():
    r = _r()
    await rs.update_rank(r, 1, 7, Decimal("10"), season_window=WIN, now=k(9, 10))   # 지난주
    await rs.update_rank(r, 1, 7, Decimal("21"), season_window=WIN, now=k(14, 10))  # 이번 주 첫 갱신
    assert await r.hget(wr.base_key(1, W), "7") == "10.0"
    assert await r.zscore(wr.week_key(1, W), "7") == pytest.approx(10.0)
    assert await r.zscore(rs.ranking_key(1), "7") == pytest.approx(21.0)          # 시즌 ZSET 불변 동작


async def test_update_rank_base_kept_on_later_updates_and_new_joiner_is_zero():
    r = _r()
    await rs.update_rank(r, 1, 8, Decimal("5"), season_window=WIN, now=k(14, 10))   # 시즌 첫 등장 → base 0
    await rs.update_rank(r, 1, 8, Decimal("-5"), season_window=WIN, now=k(15, 10))
    assert await r.hget(wr.base_key(1, W), "8") == "0.0"
    assert await r.zscore(wr.week_key(1, W), "8") == pytest.approx(-5.0)
    assert 0 < await r.ttl(wr.week_key(1, W)) <= wr.WEEK_TTL_SEC
    assert 0 < await r.ttl(wr.base_key(1, W)) <= wr.WEEK_TTL_SEC


async def test_update_rank_without_window_or_outside_season_skips_weekly():
    r = _r()
    await rs.update_rank(r, 1, 9, Decimal("3"))                                     # 기존 호출 형태
    await rs.update_rank(r, 1, 9, Decimal("4"), season_window=WIN, now=k(31, 21))   # 시즌 종료 후
    assert await r.keys("game:season:1:week:*") == []
    assert await r.zscore(rs.ranking_key(1), "9") == pytest.approx(4.0)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q -k update_rank`
Expected: FAIL — `TypeError: update_rank() got an unexpected keyword argument 'season_window'`

- [ ] **Step 3: 구현** — `ranking_service.py`

import 교체/추가:
```python
from datetime import datetime, timezone

from shared.game_models import GameAccount, GameSeason
from apps.trading_game.services import pricing, weekly_ranking
```

`update_rank`·`sync_account_rank` 교체:
```python
async def update_rank(
    redis, season_id: int, user_id: int, roi: Decimal, *,
    season_window: tuple[datetime, datetime | None] | None = None,
    now: datetime | None = None,
) -> None:
    """시즌 ZSET 갱신 + (season_window 가 있으면) 주간 ZSET 갱신.

    주간 기준값은 그 주 첫 갱신 때 시즌 ZSET 의 '갱신 전' 점수(없으면 0)를 HSETNX 로 기록한다.
    HSETNX 를 시즌 ZADD 보다 먼저 해야 동시 갱신이 바꾼 점수가 기준값이 되지 않는다.
    """
    key = ranking_key(season_id)
    member = str(user_id)
    if season_window is not None:
        now = now or datetime.now(timezone.utc)
        week_id, ws, we = weekly_ranking.week_bounds(now, *season_window)
        if ws <= now < we:
            bkey = weekly_ranking.base_key(season_id, week_id)
            wkey = weekly_ranking.week_key(season_id, week_id)
            prev = await redis.zscore(key, member)
            await redis.hsetnx(bkey, member, str(float(prev) if prev is not None else 0.0))
            base = Decimal(await redis.hget(bkey, member))
            await redis.zadd(wkey, {member: float(weekly_ranking.weekly_roi(roi, base))})
            await redis.expire(bkey, weekly_ranking.WEEK_TTL_SEC)
            await redis.expire(wkey, weekly_ranking.WEEK_TTL_SEC)
    await redis.zadd(key, {member: float(roi)})


async def sync_account_rank(redis, db: AsyncSession, account_id) -> None:
    """계좌의 현재 current_roi 를 랭킹(시즌+주간)에 반영(청산 후 호출)."""
    acc = await db.get(GameAccount, account_id)
    if acc is None:
        return
    season = await db.get(GameSeason, acc.season_id)
    window = (season.start_at, season.end_at) if season is not None else None
    await update_rank(redis, acc.season_id, acc.user_id, acc.current_roi, season_window=window)
```

`tick_listener._push_personal_pnl` — 쿼리에 GameSeason 추가하고 창 전달(루프 본문의 나머지 줄은 그대로):
```python
        rows = await db.execute(
            select(GamePosition, GameAccount, GameSeason)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(
                GamePosition.status == "OPEN",
                GameSeason.ticker == ticker,
                GameSeason.status == "ACTIVE",
            )
        )
        redis = deps.get_redis()
        for pos, acc, season in rows.all():
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, reward_service.principal(acc))
            await ranking_service.update_rank(
                redis, acc.season_id, acc.user_id, live, season_window=(season.start_at, season.end_at),
            )
```

- [ ] **Step 4: 통과 + 회귀 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q && conda run -n stock_app uv run pytest -q -x`
Expected: 신규 PASS, 전체 기존 테스트 PASS(488+). 기존 테스트가 `update_rank` 를 monkeypatch 해 위치 인자 4개만 받는 fake 를 쓰면 실패할 수 있다 → 그 fake 에 `**kwargs` 를 추가해 고친다(동작 변경 아님).

- [ ] **Step 5: 커밋**

```bash
git add backend/apps/trading_game/services/ranking_service.py backend/apps/trading_game/services/tick_listener.py backend/tests/test_weekly_ranking.py
git commit -m "feat(game): 랭킹 갱신 시 주간 ZSET 동시 갱신(첫 갱신 기준값)"
```

---

### Task 3: 모델 `WeeklyRankingResult` + 마이그레이션

**Files:**
- Modify: `backend/shared/game_models.py` (StreakRewardClaim 아래에 추가)
- Create: `backend/alembic/versions/c9d0e1f2a3b4_weekly_ranking_results.py`
- Test: `backend/tests/test_weekly_ranking.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- model
from sqlalchemy.exc import IntegrityError

from shared.game_models import WeeklyRankingResult
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_account, _seed_season, _seed_user, api, fake_redis, maker, session,
)


async def test_weekly_result_roundtrip_and_unique(session):
    u = await _seed_user(session)
    s = await _seed_season(session)
    row = WeeklyRankingResult(season_id=s.id, week_start=W, rank=1, user_id=u.id, nickname="n",
                              weekly_roi=Decimal("12.3456"), reward_amount=Decimal("500000"))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    assert row.id and row.created_at is not None and row.notified_at is None
    session.add(WeeklyRankingResult(season_id=s.id, week_start=W, rank=2, user_id=u.id,
                                    weekly_roi=Decimal("1"), reward_amount=Decimal("0")))
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q -k roundtrip`
Expected: FAIL — `ImportError: cannot import name 'WeeklyRankingResult'`

- [ ] **Step 3: 모델 추가** (`backend/shared/game_models.py`, `StreakRewardClaim` 클래스 바로 아래)

```python
class WeeklyRankingResult(Base):
    """주간 랭킹 마감 기록(Top 10) + 1~3위 보상액. notified_at = 보상 토스트 확인 시각."""

    __tablename__ = "weekly_ranking_results"
    __table_args__ = (
        UniqueConstraint("season_id", "week_start", "rank", name="uq_weekly_result_rank"),
        UniqueConstraint("season_id", "week_start", "user_id", name="uq_weekly_result_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    weekly_roi: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    reward_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, server_default="0")
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 4: 마이그레이션** (`backend/alembic/versions/c9d0e1f2a3b4_weekly_ranking_results.py`)

```python
"""weekly ranking results (weekly leaderboard archive + rewards)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weekly_ranking_results",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "season_id", sa.Integer, sa.ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("week_start", sa.Date, nullable=False),
        sa.Column("rank", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nickname", sa.String(50), nullable=True),
        sa.Column("weekly_roi", sa.Numeric(10, 4), nullable=False),
        sa.Column("reward_amount", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("season_id", "week_start", "rank", name="uq_weekly_result_rank"),
        sa.UniqueConstraint("season_id", "week_start", "user_id", name="uq_weekly_result_user"),
    )


def downgrade() -> None:
    op.drop_table("weekly_ranking_results")
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/shared/game_models.py backend/alembic/versions/c9d0e1f2a3b4_weekly_ranking_results.py backend/tests/test_weekly_ranking.py
git commit -m "feat(game): weekly_ranking_results 모델·마이그레이션"
```

(마이그레이션 실DB 검증은 Task 9 에서 컨트롤러가 수행)

---

### Task 4: 마감 `weekly_service.close_week` + 정산 연동 + Celery beat

**Files:**
- Create: `backend/apps/trading_game/services/weekly_service.py`
- Modify: `backend/apps/trading_game/services/settlement.py` (redis.delete 블록)
- Create: `backend/apps/collector/tasks/weekly_close.py`
- Modify: `backend/apps/collector/celery_app.py` (include + beat)
- Test: `backend/tests/test_weekly_ranking.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- close_week
from sqlalchemy import select

from shared.game_models import GamePosition
from apps.trading_game.services import weekly_service as ws_svc


async def _season_oct(db):
    s = await _seed_season(db)
    s.start_at, s.end_at = S_START, S_END
    await db.commit()
    return s


async def _open_pos(db, acc, created_at, status="CLOSED"):
    p = GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("70000"),
                     size_amount=Decimal("1000000"), leverage=1, status=status, created_at=created_at)
    db.add(p)
    await db.commit()
    return p


async def _results(db):
    rows = (await db.execute(select(WeeklyRankingResult).order_by(WeeklyRankingResult.rank))).scalars().all()
    return [(r.rank, r.user_id, r.reward_amount) for r in rows]


async def test_close_week_archives_top10_and_rewards_eligible(session):
    r = _r()
    s = await _season_oct(session)
    users = [await _seed_user(session, nickname=f"u{i}") for i in range(12)]
    accs = [await _seed_account(session, u, s) for u in users]
    for i, u in enumerate(users):
        await r.zadd(wr.week_key(s.id, W), {str(u.id): float(100 - i)})
    await _open_pos(session, accs[0], k(13, 10))          # 1위: 이번 주 주문 → 보상
    await _open_pos(session, accs[1], k(9, 10))           # 2위: 지난주 주문만 → 0
    await _open_pos(session, accs[2], k(18, 10))          # 3위: 이번 주 → 보상
    out = await ws_svc.close_week(session, r, s, W, with_reward=True)
    assert out == {"archived": 10, "rewarded": 2}
    res = await _results(session)
    assert len(res) == 10
    assert res[0] == (1, users[0].id, Decimal("500000.00"))
    assert res[1] == (2, users[1].id, Decimal("0.00"))
    assert res[2] == (3, users[2].id, Decimal("200000.00"))
    await session.refresh(accs[0])
    assert accs[0].cash_balance == Decimal("10500000.00")


async def test_close_week_idempotent_and_no_reward_mode(session):
    r = _r()
    s = await _season_oct(session)
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, k(13, 10))
    await r.zadd(wr.week_key(s.id, W), {str(u.id): 5.0})
    assert await ws_svc.close_week(session, r, s, W, with_reward=False) == {"archived": 1, "rewarded": 0}
    assert await ws_svc.close_week(session, r, s, W, with_reward=True) == {"archived": 0, "rewarded": 0}
    assert await _results(session) == [(1, u.id, Decimal("0.00"))]


async def test_close_week_empty_week(session):
    s = await _season_oct(session)
    assert await ws_svc.close_week(session, _r(), s, W, with_reward=True) == {"archived": 0, "rewarded": 0}


async def test_close_previous_week_skips_week_before_season(session):
    r = _r()
    s = await _season_oct(session)
    out = await ws_svc.close_previous_week(session, r, now=k(5, 8, 50))   # 지난주 = 9/28 주(시즌 10/1 시작 포함)
    assert out == {"week_start": "2026-09-28", "archived": 0, "rewarded": 0}
    s.start_at = k(6, 9)                                                   # 시즌이 그 주 이후 시작 → 건너뜀
    await session.commit()
    assert await ws_svc.close_previous_week(session, r, now=k(5, 8, 50)) is None


async def test_settlement_archives_final_week_without_reward(session):
    from apps.trading_game.services import settlement
    r = _r()
    s = await _seed_season(session)
    s.start_at = datetime(2026, 9, 28, 9, 0, tzinfo=KST)
    s.end_at = datetime(2026, 10, 1, 9, 0, tzinfo=KST)  # 이미 지난 종료(정산 대상)
    await session.commit()
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, datetime(2026, 9, 29, 10, 0, tzinfo=KST))
    await r.zadd(wr.week_key(s.id, date(2026, 9, 28)), {str(u.id): 3.0})
    await settlement.settle_due_season(session, r, lambda t: Decimal("70000"))
    assert await _results(session) == [(1, u.id, Decimal("0.00"))]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q -k "close or settlement"`
Expected: FAIL — `ImportError: cannot import name 'weekly_service'`

- [ ] **Step 3: 구현** (`backend/apps/trading_game/services/weekly_service.py`)

```python
"""주간 랭킹 마감·조회 서비스 — Top 10 기록, 1~3위 보상(그 주 신규 주문 계좌만), 미확인 보상."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.game_models import GameAccount, GamePosition, GameSeason, WeeklyRankingResult
from apps.trading_game.services import account_service, reward_service, weekly_ranking as wr

log = logging.getLogger("trading_game.weekly")


def _week_window(season: GameSeason, week_id: date) -> tuple[datetime, datetime]:
    monday_open = datetime.combine(week_id, wr.WEEK_START, tzinfo=wr.KST)
    _, s, e = wr.week_bounds(monday_open, season.start_at, season.end_at)
    return s, e


async def _opened_in_week(db: AsyncSession, account_id, start: datetime, end: datetime) -> bool:
    # SQLite(테스트)는 naive 를 돌려주므로 파이썬에서 aware 로 맞춰 비교
    rows = (await db.execute(
        select(GamePosition.created_at).where(GamePosition.account_id == account_id)
    )).scalars()
    return any(start <= wr.aware(c) < end for c in rows if c is not None)


async def close_week(db: AsyncSession, redis, season: GameSeason, week_id: date, *, with_reward: bool) -> dict:
    exists = await db.scalar(
        select(func.count()).select_from(WeeklyRankingResult)
        .where(WeeklyRankingResult.season_id == season.id, WeeklyRankingResult.week_start == week_id)
    )
    if exists:
        return {"archived": 0, "rewarded": 0}
    pairs = await redis.zrevrange(wr.week_key(season.id, week_id), 0, wr.ARCHIVE_TOP - 1, withscores=True)
    if not pairs:
        return {"archived": 0, "rewarded": 0}
    uids = [int(u) for u, _ in pairs]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all())
    start, end = _week_window(season, week_id)
    rewarded = 0
    for rank, (uid_s, score) in enumerate(pairs, start=1):
        uid = int(uid_s)
        amount = Decimal("0")
        if with_reward and rank in wr.REWARDS:
            acc = await db.scalar(
                select(GameAccount).where(GameAccount.season_id == season.id, GameAccount.user_id == uid)
            )
            if acc is not None and await _opened_in_week(db, acc.id, start, end):
                try:
                    await reward_service.grant_cash(db, acc, wr.REWARDS[rank], redis=redis)
                    amount = wr.REWARDS[rank]
                    rewarded += 1
                except reward_service.RewardUnavailable:
                    log.warning("주간 보상 보류(시세 없음) season=%s week=%s user=%s", season.id, week_id, uid)
        db.add(WeeklyRankingResult(
            season_id=season.id, week_start=week_id, rank=rank, user_id=uid, nickname=nicks.get(uid),
            weekly_roi=Decimal(str(score)).quantize(Decimal("0.0001")), reward_amount=amount,
        ))
    await db.commit()
    log.info("주간 마감 season=%s week=%s archived=%s rewarded=%s", season.id, week_id, len(pairs), rewarded)
    return {"archived": len(pairs), "rewarded": rewarded}


async def close_previous_week(db: AsyncSession, redis, *, now: datetime | None = None) -> dict | None:
    """beat(월 08:50 KST): 활성 시즌의 '지난주'(now−1일이 속한 주)를 보상 포함 마감."""
    season = await account_service.get_active_season(db)
    if season is None:
        return None
    now = now or datetime.now(timezone.utc)
    week_id, s, e = wr.week_bounds(now - timedelta(days=1), season.start_at, season.end_at)
    if s >= e:  # 지난주 창이 시즌과 겹치지 않음(시즌이 그 주 이후 시작)
        return None
    out = await close_week(db, redis, season, week_id, with_reward=True)
    return {"week_start": week_id.isoformat(), **out}


async def close_final_week(db: AsyncSession, redis, season: GameSeason) -> dict | None:
    """시즌 정산 직전: 시즌 마지막 주를 기록만(보상 없음)."""
    if season.end_at is None:
        return None
    last_moment = wr.aware(season.end_at) - timedelta(seconds=1)
    week_id, _, _ = wr.week_bounds(last_moment, season.start_at, season.end_at)
    return await close_week(db, redis, season, week_id, with_reward=False)
```

참고: `account_service.get_active_season` 이 `start_at <= now` 같은 조건을 쓰면 `close_previous_week` 테스트에서 시즌을 찾지 못할 수 있다 — 그 경우 함수 구현을 읽고 테스트 시즌이 ACTIVE 로 잡히는지 확인한다(현재는 status=ACTIVE·id desc 기준).

- [ ] **Step 4: 정산 연동** — `settlement.py` 의 마지막 `if redis is not None:` 블록을 다음으로 교체

```python
    if redis is not None:
        from apps.trading_game.services import weekly_service
        from apps.trading_game.services.ranking_service import ranking_key
        try:
            await weekly_service.close_final_week(db, redis, season)  # 시즌 마지막 주 기록(보상 없음)
        except Exception:  # noqa: BLE001 — 주간 기록 실패가 시즌 정산을 막지 않게
            log.exception("시즌 마지막 주 주간 기록 실패 season=%s", season.id)
        await redis.delete(ranking_key(season.id))
```

- [ ] **Step 5: Celery 태스크** (`backend/apps/collector/tasks/weekly_close.py`)

```python
"""주간 랭킹 마감 Celery 태스크(매주 월 08:50 KST — 지난주 Top 10 기록·1~3위 보상)."""
from __future__ import annotations

import asyncio
import logging
import os

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal, engine
from apps.collector.celery_app import celery_app
from apps.trading_game.services import weekly_service

log = logging.getLogger("trading_game.weekly_task")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def _run() -> dict | None:
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    try:
        async with AsyncSessionLocal() as db:
            return await weekly_service.close_previous_week(db, redis)
    finally:
        await redis.aclose()
        await engine.dispose()


@celery_app.task(name="close_trading_week")
def close_trading_week() -> dict | None:
    result = asyncio.run(_run())
    log.info("주간 마감 결과: %s", result)
    return result
```

`celery_app.py`: include 목록에 `"apps.collector.tasks.weekly_close",` 추가, beat_schedule 에:
```python
    # 주간 랭킹 마감 — 월요일 장 시작(09:00) 전. 지난주 Top 10 기록·1~3위 보상
    "close-trading-week": {
        "task": "close_trading_week",
        "schedule": crontab(hour=8, minute=50, day_of_week=1),
    },
```
(celery `timezone` 이 Asia/Seoul 인지 `celery_app.conf` 에서 확인 — 기존 20:40 정산이 KST 기준)

- [ ] **Step 6: 통과 + 전체 회귀**

Run: `cd backend && conda run -n stock_app uv run pytest -q`
Expected: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/apps/trading_game/services/weekly_service.py backend/apps/trading_game/services/settlement.py backend/apps/collector/tasks/weekly_close.py backend/apps/collector/celery_app.py backend/tests/test_weekly_ranking.py
git commit -m "feat(game): 주간 랭킹 마감·보상(월 08:50)·시즌 마지막 주 기록"
```

---

### Task 5: API 5종

**Files:**
- Modify: `backend/apps/trading_game/services/weekly_service.py` (조회 함수)
- Modify: `backend/apps/trading_game/routers/leaderboard.py`
- Test: `backend/tests/test_weekly_ranking.py`

- [ ] **Step 1: 실패 테스트 추가**

```python
# ---------------------------------------------------------------- API
async def test_weekly_leaderboard_and_my_rank(api, fake_redis, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        s = await _season_oct(db)
        u1 = await _seed_user(db, nickname="가")
        u2 = await _seed_user(db, nickname="나")
    monkeypatch.setattr(ws_svc, "_now", lambda: k(14, 12))
    await fake_redis.zadd(wr.week_key(s.id, W), {str(u1.id): 1.5, str(u2.id): 3.0})
    res = await client.get(f"/api/game/seasons/{s.id}/weekly-leaderboard")
    assert res.status_code == 200
    body = res.json()
    assert body["week_start"] == "2026-10-12"
    assert [(e["rank"], e["nickname"], e["weekly_roi"]) for e in body["entries"]] == [(1, "나", 3.0), (2, "가", 1.5)]
    set_user(u1)
    me = (await client.get(f"/api/game/seasons/{s.id}/weekly-my-rank")).json()
    assert me == {"rank": 2, "weekly_roi": 1.5, "total": 2}
    assert (await client.get("/api/game/seasons/999/weekly-leaderboard")).status_code == 404


async def test_weekly_results_unseen_and_ack(api, fake_redis, maker):
    client, set_user = api
    async with maker() as db:
        s = await _season_oct(db)
        u1 = await _seed_user(db, nickname="가")
        u2 = await _seed_user(db, nickname="나")
        db.add_all([
            WeeklyRankingResult(season_id=s.id, week_start=W, rank=1, user_id=u1.id, nickname="가",
                                weekly_roi=Decimal("9"), reward_amount=Decimal("500000")),
            WeeklyRankingResult(season_id=s.id, week_start=W, rank=2, user_id=u2.id, nickname="나",
                                weekly_roi=Decimal("4"), reward_amount=Decimal("0")),
        ])
        await db.commit()
    results = (await client.get(f"/api/game/weekly-results?season_id={s.id}")).json()
    assert results == [{"season_id": s.id, "week_start": "2026-10-12", "entries": [
        {"rank": 1, "nickname": "가", "weekly_roi": 9.0, "reward_amount": 500000.0},
        {"rank": 2, "nickname": "나", "weekly_roi": 4.0, "reward_amount": 0.0},
    ]}]
    set_user(u1)
    unseen = (await client.get("/api/game/weekly-rewards/unseen")).json()
    assert [(x["rank"], x["reward_amount"], x["week_start"]) for x in unseen] == [(1, 500000.0, "2026-10-12")]
    set_user(u2)
    assert (await client.post(f"/api/game/weekly-rewards/{unseen[0]['id']}/ack")).status_code == 404  # 남의 것
    set_user(u1)
    assert (await client.post(f"/api/game/weekly-rewards/{unseen[0]['id']}/ack")).status_code == 204
    assert (await client.get("/api/game/weekly-rewards/unseen")).json() == []
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && conda run -n stock_app uv run pytest tests/test_weekly_ranking.py -q -k "weekly_leaderboard or unseen"`
Expected: FAIL (404 / AttributeError `_now`)

- [ ] **Step 3: 서비스 조회 함수** (`weekly_service.py` 끝에 추가)

```python
def _now() -> datetime:
    return datetime.now(timezone.utc)


def current_week(season: GameSeason) -> tuple[date, datetime, datetime]:
    """현재 주. 시즌이 끝났으면 마지막 주."""
    now = _now()
    if season.end_at is not None and now >= wr.aware(season.end_at):
        now = wr.aware(season.end_at) - timedelta(seconds=1)
    return wr.week_bounds(now, season.start_at, season.end_at)


async def weekly_leaderboard(db: AsyncSession, redis, season: GameSeason, limit: int = 100) -> dict:
    week_id, s, e = current_week(season)
    pairs = await redis.zrevrange(wr.week_key(season.id, week_id), 0, limit - 1, withscores=True)
    uids = [int(u) for u, _ in pairs]
    nicks = dict((await db.execute(select(User.id, User.nickname).where(User.id.in_(uids)))).all()) if uids else {}
    return {
        "week_start": week_id.isoformat(), "start_at": s.isoformat(), "end_at": e.isoformat(),
        "entries": [
            {"rank": i + 1, "user_id": int(u), "nickname": nicks.get(int(u)), "weekly_roi": float(score)}
            for i, (u, score) in enumerate(pairs)
        ],
    }


async def weekly_my_rank(redis, season: GameSeason, user_id: int) -> dict:
    week_id, _, _ = current_week(season)
    key = wr.week_key(season.id, week_id)
    total = await redis.zcard(key)
    rank = await redis.zrevrank(key, str(user_id))
    if rank is None:
        return {"rank": None, "weekly_roi": None, "total": total}
    score = await redis.zscore(key, str(user_id))
    return {"rank": rank + 1, "weekly_roi": float(score), "total": total}


async def weekly_results(db: AsyncSession, season_id: int | None, limit: int) -> list[dict]:
    """지난 주들의 Top 3(최신 주 먼저)."""
    weeks_q = select(WeeklyRankingResult.season_id, WeeklyRankingResult.week_start).distinct()
    if season_id is not None:
        weeks_q = weeks_q.where(WeeklyRankingResult.season_id == season_id)
    weeks = (await db.execute(
        weeks_q.order_by(WeeklyRankingResult.week_start.desc(), WeeklyRankingResult.season_id.desc()).limit(limit)
    )).all()
    out = []
    for sid, wk in weeks:
        rows = (await db.execute(
            select(WeeklyRankingResult)
            .where(WeeklyRankingResult.season_id == sid, WeeklyRankingResult.week_start == wk,
                   WeeklyRankingResult.rank <= 3)
            .order_by(WeeklyRankingResult.rank)
        )).scalars().all()
        out.append({"season_id": sid, "week_start": wk.isoformat(), "entries": [
            {"rank": r.rank, "nickname": r.nickname, "weekly_roi": float(r.weekly_roi),
             "reward_amount": float(r.reward_amount)} for r in rows
        ]})
    return out


async def unseen_rewards(db: AsyncSession, user_id: int) -> list[dict]:
    rows = (await db.execute(
        select(WeeklyRankingResult)
        .where(WeeklyRankingResult.user_id == user_id, WeeklyRankingResult.reward_amount > 0,
               WeeklyRankingResult.notified_at.is_(None))
        .order_by(WeeklyRankingResult.id)
    )).scalars().all()
    return [{"id": r.id, "week_start": r.week_start.isoformat(), "rank": r.rank,
             "reward_amount": float(r.reward_amount)} for r in rows]


async def ack_reward(db: AsyncSession, user_id: int, result_id: int) -> bool:
    row = await db.get(WeeklyRankingResult, result_id)
    if row is None or row.user_id != user_id:
        return False
    if row.notified_at is None:
        row.notified_at = _now()
        await db.commit()
    return True
```

- [ ] **Step 4: 라우터** (`leaderboard.py`) — import 를 `from fastapi import APIRouter, Depends, HTTPException, Query, Response` 로, 서비스 import 에 `weekly_service` 추가. 파일 끝에:

```python
async def _season_or_404(db: AsyncSession, season_id: int) -> GameSeason:
    s = await db.get(GameSeason, season_id)
    if s is None:
        raise HTTPException(status_code=404, detail="SEASON_NOT_FOUND")
    return s


@router.get("/seasons/{season_id}/weekly-leaderboard")
async def weekly_leaderboard(season_id: int, db: AsyncSession = Depends(get_db)):
    """공개 — 이번 주 Top 100(월 09:00 시작, 시즌 경계로 잘림)."""
    season = await _season_or_404(db, season_id)
    return await weekly_service.weekly_leaderboard(db, deps.get_redis(), season)


@router.get("/seasons/{season_id}/weekly-my-rank")
async def weekly_my_rank(
    season_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    season = await _season_or_404(db, season_id)
    return await weekly_service.weekly_my_rank(deps.get_redis(), season, user.id)


@router.get("/weekly-results")
async def weekly_results(
    season_id: int | None = Query(default=None),
    limit: int = Query(default=4, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """공개 — 지난 주들의 Top 3(최신 주 먼저)."""
    return await weekly_service.weekly_results(db, season_id, limit)


@router.get("/weekly-rewards/unseen")
async def weekly_rewards_unseen(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await weekly_service.unseen_rewards(db, user.id)


@router.post("/weekly-rewards/{result_id}/ack", status_code=204)
async def weekly_reward_ack(
    result_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not await weekly_service.ack_reward(db, user.id, result_id):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    return Response(status_code=204)
```

- [ ] **Step 5: 통과 + 전체**

Run: `cd backend && conda run -n stock_app uv run pytest -q`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/apps/trading_game/services/weekly_service.py backend/apps/trading_game/routers/leaderboard.py backend/tests/test_weekly_ranking.py
git commit -m "feat(game): 주간 랭킹·결과·미확인 보상 API"
```

---

### Task 6: web_client — 주간 탭 + 보상 토스트

**Files:**
- Modify: `web_client/src/types/game.ts`, `web_client/src/api/game.ts`, `web_client/src/lib/format.ts`, `web_client/src/store/tradingGame.ts`, `web_client/src/components/game/LeaderboardModal.tsx`
- Create: `web_client/src/components/game/WeeklyRankingTab.tsx`

- [ ] **Step 1: 타입** (`types/game.ts` 끝에 추가)

```ts
export interface WeeklyEntry {
  rank: number
  user_id: number
  nickname: string | null
  weekly_roi: number
}

export interface WeeklyBoard {
  week_start: string
  start_at: string
  end_at: string
  entries: WeeklyEntry[]
}

export interface WeeklyMyRank {
  rank: number | null
  weekly_roi: number | null
  total: number
}

export interface WeeklyResultWeek {
  season_id: number
  week_start: string
  entries: { rank: number; nickname: string | null; weekly_roi: number; reward_amount: number }[]
}

export interface WeeklyReward {
  id: number
  week_start: string
  rank: number
  reward_amount: number
}
```

- [ ] **Step 2: API** (`api/game.ts`, `getHallOfFame` 아래; 타입 import 목록에 `WeeklyBoard, WeeklyMyRank, WeeklyResultWeek, WeeklyReward` 추가)

```ts
/** 공개 — 이번 주 Top 100(월 09:00 시작, 시즌 경계로 잘림) */
export async function getWeeklyLeaderboard(seasonId: number): Promise<WeeklyBoard> {
  const { data } = await client().get<WeeklyBoard>(`/api/game/seasons/${seasonId}/weekly-leaderboard`)
  return data
}

export async function getWeeklyMyRank(seasonId: number): Promise<WeeklyMyRank> {
  const { data } = await client().get<WeeklyMyRank>(`/api/game/seasons/${seasonId}/weekly-my-rank`)
  return data
}

/** 공개 — 지난 주들의 Top 3(최신 주 먼저) */
export async function getWeeklyResults(seasonId: number, limit = 1): Promise<WeeklyResultWeek[]> {
  const { data } = await client().get<WeeklyResultWeek[]>('/api/game/weekly-results', {
    params: { season_id: seasonId, limit },
  })
  return data
}

export async function getUnseenWeeklyRewards(): Promise<WeeklyReward[]> {
  const { data } = await client().get<WeeklyReward[]>('/api/game/weekly-rewards/unseen')
  return data
}

export async function ackWeeklyReward(id: number): Promise<void> {
  await client().post(`/api/game/weekly-rewards/${id}/ack`)
}
```

- [ ] **Step 3: 포맷 함수** (`lib/format.ts` 끝에 추가 — KST 고정 표기)

```ts
const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** ISO 시각 → KST "10/12(월) 09:00" (브라우저 시간대 무관) */
export function formatKstShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]}) ${hh}:${mm}`
}

/** 주간 기간 "10/12(월) 09:00 ~ 10/19(월) 09:00" */
export const formatWeekRange = (startIso: string, endIso: string): string =>
  `${formatKstShort(startIso)} ~ ${formatKstShort(endIso)}`

/** 원 단위 금액 "500,000원" */
export const formatWon = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`
```
(`format.ts` 에 이미 같은 역할의 금액 함수가 있으면 그것을 쓰고 `formatWon` 은 추가하지 않는다)

- [ ] **Step 4: 주간 탭 컴포넌트** (`components/game/WeeklyRankingTab.tsx`)

```tsx
import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { getWeeklyLeaderboard, getWeeklyMyRank, getWeeklyResults } from '../../api/game'
import { formatPct, formatWeekRange, formatWon, pnlClass } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import type { WeeklyBoard, WeeklyMyRank, WeeklyResultWeek } from '../../types/game'

interface WeeklyRankingTabProps {
  seasonId: number
  myUserId: number | null
}

type Data = { board: WeeklyBoard; me: WeeklyMyRank | null; last: WeeklyResultWeek | null }
type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data }

const MEDAL = ['🥇', '🥈', '🥉']

// 주간 탭 — 이번 주 기간·내 순위·지난주 Top 3·Top 100. 내 순위·지난주는 실패해도 목록은 표시.
export default function WeeklyRankingTab({ seasonId, myUserId }: WeeklyRankingTabProps) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    Promise.all([
      getWeeklyLeaderboard(seasonId),
      myUserId !== null ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      getWeeklyResults(seasonId, 1).catch((): WeeklyResultWeek[] => []),
    ])
      .then(([board, me, results]) => {
        if (!cancelled) setState({ kind: 'ok', data: { board, me, last: results[0] ?? null } })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [seasonId, myUserId, reloadKey])

  if (state.kind === 'loading') return <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>
  if (state.kind === 'error')
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-ink-muted">{state.message}</p>
        <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
          다시 시도
        </Button>
      </div>
    )

  const { board, me, last } = state.data
  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-muted">
        <p className="font-medium text-ink">{formatWeekRange(board.start_at, board.end_at)}</p>
        <p className="mt-1">1~3위 50만·30만·20만 원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만</p>
      </div>

      {me && me.rank !== null && me.weekly_roi !== null && (
        <div className="flex items-center justify-between rounded-field bg-brand-soft px-3 py-2 text-sm">
          <span className="text-ink">
            내 주간 순위 <b>{me.rank}위</b> / {me.total}명
          </span>
          <span className={`font-semibold tabular-nums ${pnlClass(me.weekly_roi)}`}>{formatPct(me.weekly_roi)}</span>
        </div>
      )}

      {last && last.entries.length > 0 && (
        <section className="rounded-field border border-line px-3 py-2">
          <h3 className="mb-1 text-xs font-bold text-ink">지난주 Top 3</h3>
          <ol className="space-y-0.5 text-sm">
            {last.entries.map((e) => (
              <li key={e.rank} className="flex items-center gap-2">
                <span className="w-6">{MEDAL[e.rank - 1] ?? e.rank}</span>
                <span className="flex-1 truncate text-ink">{e.nickname ?? '익명'}</span>
                <span className={`tabular-nums ${pnlClass(e.weekly_roi)}`}>{formatPct(e.weekly_roi)}</span>
                {e.reward_amount > 0 && <span className="text-xs text-ink-muted">{formatWon(e.reward_amount)}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {board.entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">이번 주 순위가 아직 없어요</p>
      ) : (
        <ol className="space-y-1">
          {board.entries.map((r) => {
            const mine = myUserId !== null && r.user_id === myUserId
            return (
              <li
                key={r.user_id}
                className={`flex items-center gap-3 rounded-field px-3 py-2 text-sm ${mine ? 'bg-brand-soft' : ''}`}
              >
                <span className="w-8 shrink-0 font-bold tabular-nums text-ink">{r.rank}</span>
                <span className="flex-1 truncate text-ink">
                  {r.nickname ?? '익명'}
                  {mine && <span className="ml-1 text-xs font-semibold text-brand">나</span>}
                </span>
                <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.weekly_roi)}`}>
                  {formatPct(r.weekly_roi)}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
```
(`border-line` 토큰이 tailwind 설정에 없으면 기존 컴포넌트에서 쓰는 테두리 토큰으로 바꾼다 — `tailwind.config`/`index.css` 확인)

- [ ] **Step 5: 모달에 탭 추가** (`LeaderboardModal.tsx`)
- `type Tab = 'weekly' | 'season' | 'hof'`, `useState<Tab>('weekly')`.
- `import WeeklyRankingTab from './WeeklyRankingTab'`.
- useEffect 첫 줄(`let cancelled` 앞)에 `if (tab === 'weekly') return` — 주간 탭은 자체 로드.
- 로딩·에러 블록 두 개를 각각 `tab !== 'weekly' && current.kind === ...` 조건으로 바꾼다.
- 탭 버튼 맨 앞에:
```tsx
        <button type="button" role="tab" aria-selected={tab === 'weekly'} onClick={() => setTab('weekly')} className={chipClass(tab === 'weekly')}>
          주간
        </button>
```
- 탭 목록 바로 아래 본문에 `{tab === 'weekly' && <WeeklyRankingTab seasonId={seasonId} myUserId={myUserId} />}`.
- 컴포넌트 위 주석을 "랭킹 모달 — 주간 / 시즌 Top 100 / 명예의 전당(MBTI). …" 로 갱신.

- [ ] **Step 6: 보상 토스트** (`store/tradingGame.ts`)
상태 인터페이스(액션 목록)에 `checkWeeklyRewards: () => Promise<void>` 추가, `WeeklyReward` 타입 import. 액션 구현(`refreshStreak,` 다음):
```ts
    checkWeeklyRewards: async () => {
      const gen = privateGen
      let rewards: WeeklyReward[]
      try {
        rewards = await gameApi.getUnseenWeeklyRewards()
      } catch {
        return // 알림 실패는 조용히(다음 진입 때 재시도)
      }
      if (gen !== privateGen || rewards.length === 0) return
      for (const r of rewards) {
        get().pushToast({
          kind: 'info',
          icon: '🏅',
          message: `지난주 주간 랭킹 ${r.rank}위! 보상 ${r.reward_amount.toLocaleString('ko-KR')}원이 지급됐어요`,
        })
        gameApi.ackWeeklyReward(r.id).catch(() => undefined)
      }
      await refreshTrading()
    },
```
`loadPrivate` 의 `set(patch)` 다음 줄에 `void get().checkWeeklyRewards()`.

- [ ] **Step 7: 검증**

Run: `cd web_client && npx tsc --noEmit && npm run build`
Expected: 오류 0, 빌드 성공

- [ ] **Step 8: 커밋**

```bash
git add web_client/src/types/game.ts web_client/src/api/game.ts web_client/src/lib/format.ts web_client/src/store/tradingGame.ts web_client/src/components/game/LeaderboardModal.tsx web_client/src/components/game/WeeklyRankingTab.tsx
git commit -m "feat(web): 랭킹 주간 탭·지난주 Top3·주간 보상 토스트"
```

---

### Task 7: mobile — 주간 탭 + 보상 토스트

**Files:**
- Modify: `mobile/src/features/game/types.ts`, `api.ts`, `store.ts`, `components/leaderboard-sheet.tsx`
- Create: `mobile/src/features/game/lib/weekly.ts`, `lib/weekly.test.ts`, `components/weekly-ranking-tab.tsx`

- [ ] **Step 1: 타입** — `types.ts` 끝에 Task 6 Step 1 의 5개 인터페이스(`WeeklyEntry`, `WeeklyBoard`, `WeeklyMyRank`, `WeeklyResultWeek`, `WeeklyReward`)를 세미콜론 스타일로 동일하게 추가:

```ts
export interface WeeklyEntry {
  rank: number;
  user_id: number;
  nickname: string | null;
  weekly_roi: number;
}

export interface WeeklyBoard {
  week_start: string;
  start_at: string;
  end_at: string;
  entries: WeeklyEntry[];
}

export interface WeeklyMyRank {
  rank: number | null;
  weekly_roi: number | null;
  total: number;
}

export interface WeeklyResultWeek {
  season_id: number;
  week_start: string;
  entries: { rank: number; nickname: string | null; weekly_roi: number; reward_amount: number }[];
}

export interface WeeklyReward {
  id: number;
  week_start: string;
  rank: number;
  reward_amount: number;
}
```

- [ ] **Step 2: 실패 테스트** (`lib/weekly.test.ts`)

```ts
import { formatKstShort, formatWeekRange, formatWon, rewardToastMessage } from './weekly';

describe('weekly', () => {
  it('KST 짧은 표기', () => {
    expect(formatKstShort('2026-10-12T00:00:00+00:00')).toBe('10/12(월) 09:00');
    expect(formatKstShort('2026-10-31T20:00:00+09:00')).toBe('10/31(토) 20:00');
  });
  it('기간', () => {
    expect(formatWeekRange('2026-10-12T09:00:00+09:00', '2026-10-19T09:00:00+09:00')).toBe(
      '10/12(월) 09:00 ~ 10/19(월) 09:00',
    );
  });
  it('금액·보상 토스트 문구', () => {
    expect(formatWon(300000)).toBe('300,000원');
    expect(rewardToastMessage({ id: 1, week_start: '2026-10-12', rank: 1, reward_amount: 500000 })).toBe(
      '지난주 주간 랭킹 1위! 보상 500,000원이 지급됐어요',
    );
  });
});
```

Run: `cd mobile && npx jest src/features/game/lib/weekly.test.ts`
Expected: FAIL — Cannot find module './weekly'

- [ ] **Step 3: lib 구현** (`lib/weekly.ts`)

```ts
import type { WeeklyReward } from '../types';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO 시각 → KST "10/12(월) 09:00" (기기 시간대 무관) */
export function formatKstShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]}) ${hh}:${mm}`;
}

export const formatWeekRange = (startIso: string, endIso: string): string =>
  `${formatKstShort(startIso)} ~ ${formatKstShort(endIso)}`;

// Hermes 의 toLocaleString 지역화가 빌드마다 달라 정규식 천 단위 구분 사용
const won = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const formatWon = (n: number): string => `${won(n)}원`;

export const rewardToastMessage = (r: WeeklyReward): string =>
  `지난주 주간 랭킹 ${r.rank}위! 보상 ${won(r.reward_amount)}원이 지급됐어요`;

export const WEEKLY_RULE = '1~3위 50만·30만·20만 원 · 그 주 신규 주문 1회 이상 · 시즌 마지막 주는 기록만';
```

Run: `cd mobile && npx jest src/features/game/lib/weekly.test.ts` → PASS

- [ ] **Step 4: API** (`api.ts`, `getHallOfFame` 근처; 타입 import 추가. mobile `client().get<T>()` 는 데이터를 바로 반환)

```ts
/** 공개 — 이번 주 Top 100 */
export function getWeeklyLeaderboard(seasonId: number): Promise<WeeklyBoard> {
  return client().get<WeeklyBoard>(`/api/game/seasons/${seasonId}/weekly-leaderboard`);
}

export function getWeeklyMyRank(seasonId: number): Promise<WeeklyMyRank> {
  return client().get<WeeklyMyRank>(`/api/game/seasons/${seasonId}/weekly-my-rank`);
}

/** 공개 — 지난 주들의 Top 3(최신 주 먼저) */
export function getWeeklyResults(seasonId: number, limit = 1): Promise<WeeklyResultWeek[]> {
  return client().get<WeeklyResultWeek[]>(`/api/game/weekly-results?season_id=${seasonId}&limit=${limit}`);
}

export function getUnseenWeeklyRewards(): Promise<WeeklyReward[]> {
  return client().get<WeeklyReward[]>('/api/game/weekly-rewards/unseen');
}

export async function ackWeeklyReward(id: number): Promise<void> {
  await client().post(`/api/game/weekly-rewards/${id}/ack`);
}
```
(mobile client 의 `post` 가 body 인자를 요구하면 `{}` 를 넘긴다. 204 빈 응답을 JSON 파싱하다 throw 하는지 client 구현을 확인 — throw 해도 호출부가 `.catch` 로 무시하므로 동작엔 지장 없지만, client 에 빈 본문 처리가 이미 있으면 그대로 둔다)

- [ ] **Step 5: 주간 탭 컴포넌트** (`components/weekly-ranking-tab.tsx`)

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button } from '@/ui';

import { getWeeklyLeaderboard, getWeeklyMyRank, getWeeklyResults } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { formatWeekRange, formatWon, WEEKLY_RULE } from '../lib/weekly';
import type { WeeklyBoard, WeeklyMyRank, WeeklyResultWeek } from '../types';

type Props = { seasonId: number; myUserId: number | null };
type Data = { board: WeeklyBoard; me: WeeklyMyRank | null; last: WeeklyResultWeek | null };
type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data };

const MEDAL = ['🥇', '🥈', '🥉'];

/** 주간 탭 — 이번 주 기간·내 순위·지난주 Top 3·Top 100. 내 순위·지난주는 실패해도 목록은 표시 */
export function WeeklyRankingTab({ seasonId, myUserId }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    Promise.all([
      getWeeklyLeaderboard(seasonId),
      myUserId !== null ? getWeeklyMyRank(seasonId).catch(() => null) : Promise.resolve(null),
      getWeeklyResults(seasonId, 1).catch((): WeeklyResultWeek[] => []),
    ])
      .then(([board, me, results]) => {
        if (!cancelled) setState({ kind: 'ok', data: { board, me, last: results[0] ?? null } });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [seasonId, myUserId, reloadKey]);

  if (state.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator />
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.state}>
        <Text style={styles.muted}>{state.message}</Text>
        <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
      </View>
    );
  }

  const { board, me, last } = state.data;
  return (
    <View style={styles.wrap}>
      <View>
        <Text style={styles.period}>{formatWeekRange(board.start_at, board.end_at)}</Text>
        <Text style={styles.rule}>{WEEKLY_RULE}</Text>
      </View>

      {me && me.rank !== null && me.weekly_roi !== null ? (
        <View style={[styles.row, styles.mine]}>
          <Text style={styles.name}>
            내 주간 순위 <Text style={styles.bold}>{me.rank}위</Text> / {me.total}명
          </Text>
          <AmountText value={me.weekly_roi} kind="pct" size={14} weight="600" />
        </View>
      ) : null}

      {last && last.entries.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>지난주 Top 3</Text>
          {last.entries.map((e) => (
            <View key={e.rank} style={styles.lastRow}>
              <Text style={styles.medal}>{MEDAL[e.rank - 1] ?? e.rank}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {e.nickname ?? '익명'}
              </Text>
              <AmountText value={e.weekly_roi} kind="pct" size={13} weight="500" />
              {e.reward_amount > 0 ? <Text style={styles.reward}>{formatWon(e.reward_amount)}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {board.entries.length === 0 ? (
        <Text style={[styles.muted, styles.empty]}>이번 주 순위가 아직 없어요</Text>
      ) : (
        <View>
          {board.entries.map((r) => {
            const mine = myUserId !== null && r.user_id === myUserId;
            return (
              <View key={r.user_id} style={[styles.row, mine && styles.mine]}>
                <Text style={styles.rank}>{r.rank}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {r.nickname ?? '익명'}
                  {mine ? <Text style={styles.me}> 나</Text> : null}
                </Text>
                <AmountText value={r.weekly_roi} kind="pct" size={14} weight="600" />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.gap(2) },
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  empty: { paddingVertical: theme.gap(3) },
  period: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  rule: { marginTop: 2, fontSize: 12, color: theme.colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: theme.radius.input,
  },
  mine: { backgroundColor: theme.colors.primarySoft },
  rank: { width: 28, fontSize: 14, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  name: { flex: 1, fontSize: 14, color: theme.colors.text },
  bold: { fontWeight: '700' },
  me: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    padding: theme.gap(1.5),
    gap: theme.gap(0.5),
  },
  cardTitle: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1) },
  medal: { width: 22, fontSize: 14 },
  reward: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 6: 시트 탭 + 토스트**
- `leaderboard-sheet.tsx`: `type Tab = 'weekly' | 'season' | 'hof'`, `useState<Tab>('weekly')`; `import { WeeklyRankingTab } from './weekly-ranking-tab'`; useEffect 첫 줄 `if (tab === 'weekly') return;`; 로딩·에러 블록을 `tab !== 'weekly' && current.kind === ...` 조건으로; 칩 맨 앞 `<Chip label="주간" selected={tab === 'weekly'} onPress={() => setTab('weekly')} />`; 탭 아래 `{tab === 'weekly' ? <WeeklyRankingTab seasonId={seasonId} myUserId={myUserId} /> : null}`; 주석 갱신.
- `store.ts`: 액션 목록에 `checkWeeklyRewards: () => Promise<void>;`, 구현(`refreshStreak,` 다음):
```ts
    checkWeeklyRewards: async () => {
      const gen = privateGen;
      let rewards: WeeklyReward[];
      try {
        rewards = await gameApi.getUnseenWeeklyRewards();
      } catch {
        return; // 알림 실패는 조용히(다음 진입 때 재시도)
      }
      if (gen !== privateGen || rewards.length === 0) return;
      for (const r of rewards) {
        get().pushToast({ kind: 'info', icon: '🏅', message: rewardToastMessage(r) });
        gameApi.ackWeeklyReward(r.id).catch(() => undefined);
      }
      await refreshTrading();
    },
```
`import { rewardToastMessage } from './lib/weekly'`, `WeeklyReward` 타입 import. `loadPrivate` 의 `set(patch);` 다음에 `void get().checkWeeklyRewards();`. (mobile `GameToast.kind` 에 `'info'` 가 없으면 union 에 추가)

- [ ] **Step 7: 검증**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: tsc 오류 0, jest 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add mobile/src/features/game/types.ts mobile/src/features/game/api.ts mobile/src/features/game/store.ts mobile/src/features/game/components/leaderboard-sheet.tsx mobile/src/features/game/components/weekly-ranking-tab.tsx mobile/src/features/game/lib/weekly.ts mobile/src/features/game/lib/weekly.test.ts
git commit -m "feat(mobile): 랭킹 주간 탭·지난주 Top3·주간 보상 토스트"
```

---

### Task 8: 문서

**Files:** `README.md`(트레이딩 게임 섹션), `docs/ROADMAP.md`(있으면), `docs/pending_checks.md`

- [ ] README 트레이딩 게임 섹션에 한 단락: 주간 랭킹(월 09:00~, 시즌 경계로 잘림, 주간 ROI = NAV 비율), Celery beat `close-trading-week`(월 08:50 KST), 보상 50만/30만/20만(그 주 신규 주문 계좌, 시즌 마지막 주는 기록만), API 5종 경로.
- pending_checks.md: §2 web·mobile 에 "랭킹 주간 탭·지난주 Top 3·보상 토스트", §3 에 "주간 마감 첫 실행(월 08:50) 후 `weekly_ranking_results` 행·보상 지급 확인", §5 에 "주간 기준값은 그 주 첫 랭킹 갱신 때 Redis 에 기록 — Redis 초기화 시 그 주 주간 순위도 초기화".
- ROADMAP 에 "주간 랭킹 ✅" 한 줄(파일이 있을 때).
- 커밋: 명시 경로만 add → `docs: 주간 랭킹 README·체크리스트`

---

### Task 9: 통합 검증 (컨트롤러 수행)

- [ ] 마이그레이션: 로컬 docker PG(localhost:5432) 일회용 DB 생성 → `alembic upgrade head` → `downgrade -1` → `upgrade head` → DB 삭제. (dev 터널 15432 금지, 비밀번호 출력 금지)
- [ ] backend 전체 pytest, web tsc/build, mobile tsc/jest.
- [ ] 로컬 스모크: trading_game(8004)·auth(8001) + Mock 틱(`MOCK_TICK_STREAM=true`)으로 주문 → `weekly-leaderboard` 등장 확인. `close_week` 를 scratchpad 스크립트로 직접 호출해 결과·보상 생성 → 토스트 확인.
- [ ] **모바일 에뮬레이터**: Android 에뮬레이터 부팅, `adb reverse tcp:N tcp:N`(8000·8001·8002·8003·8004·8082), Metro `npx expo start --dev-client --port 8082`, dev build 앱 → 게임 탭 → 🏆 랭킹 시트 "주간" 탭·지난주 Top 3·보상 토스트 스크린샷.
- [ ] web 브라우저 스모크: 랭킹 모달 주간 탭.
- [ ] 로컬 main ff: `git fetch . dev:main`.

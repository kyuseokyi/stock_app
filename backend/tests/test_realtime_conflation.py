"""실시간 경로 — 포지션 메모리 캐시 · 틱 청산(캐시 후보 + DB 확정) · 전송 묶기(conflation)."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameAccount, GamePosition, GameSeason, GameTrade
from apps.trading_game.services import liquidation_service, position_cache, tick_listener


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


async def _seed_season(db, *, status="ACTIVE", ticker="005930", end_at=None, number=1) -> GameSeason:
    season = GameSeason(
        season_number=number, ticker=ticker, stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, tzinfo=timezone.utc), end_at=end_at, status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def _seed_position(db, season, *, side="LONG", entry="100", lev=1, sl=None, tp=None,
                         cash="9000000", bonus="0") -> tuple[int, GamePosition]:
    u = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    acc = GameAccount(user_id=u.id, season_id=season.id, cash_balance=Decimal(cash),
                      bonus_cash=Decimal(bonus))
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    pos = GamePosition(
        account_id=acc.id, side=side, entry_price=Decimal(entry), size_amount=Decimal("1000000"),
        entry_ratio=Decimal("0.1"), leverage=lev, status="OPEN",
        stop_loss_price=Decimal(sl) if sl else None, take_profit_price=Decimal(tp) if tp else None,
    )
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return u.id, pos


class _Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class _CountingMaker:
    """세션 팩토리 래퍼 — 세션 생성 횟수 집계(=DB 조회 발생 여부)."""

    def __init__(self, inner) -> None:
        self.inner = inner
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.inner()


def _boom_maker():
    raise AssertionError("DB 조회 금지 경로에서 세션 생성")


# ---------------------------------------------------------------- cache: 적재·dirty·TTL
async def test_cache_loads_open_positions_of_active_season(maker):
    async with maker() as db:
        season = await _seed_season(db)
        uid, pos = await _seed_position(db, season, side="SHORT", sl="102", tp="95", lev=2, bonus="1000000")
        other = await _seed_season(db, status="ENDED", ticker="000660", number=2)
        await _seed_position(db, other)
    snap = await position_cache.PositionCache(ttl=5.0).get(maker)
    rows = snap.for_ticker("005930")
    assert len(rows) == 1 and snap.for_ticker("000660") == []
    p = rows[0]
    assert (p.position_id, p.user_id, p.side, p.leverage) == (pos.id, uid, "SHORT", 2)
    assert (p.entry_price, p.stop_loss_price, p.take_profit_price) == (Decimal("100"), Decimal("102"), Decimal("95"))
    acc = snap.accounts[p.account_id]
    assert acc.cash_balance == Decimal("9000000")
    assert acc.principal == Decimal("11000000")  # INITIAL_CASH + bonus_cash (reward_service.principal)
    assert snap.season_windows[p.season_id][0].replace(tzinfo=None) == datetime(2026, 10, 1)


async def test_cache_reuses_snapshot_within_ttl_and_reloads_on_dirty_or_ttl(maker):
    clock = _Clock()
    cache = position_cache.PositionCache(ttl=5.0, clock=clock)
    counting = _CountingMaker(maker)
    async with maker() as db:
        season = await _seed_season(db)
    assert (await cache.get(counting)).for_ticker("005930") == []
    assert counting.calls == 1
    async with maker() as db:
        await _seed_position(db, season)
    clock.t += 4.9
    assert (await cache.get(counting)).for_ticker("005930") == []  # TTL 내 — 재조회 없음
    assert counting.calls == 1
    cache.mark_dirty()
    assert len((await cache.get(counting)).for_ticker("005930")) == 1
    assert counting.calls == 2
    clock.t += 5.0
    await cache.get(counting)
    assert counting.calls == 3  # TTL 경과 → 재적재


async def test_cache_mark_dirty_during_reload_is_not_lost(maker):
    cache = position_cache.PositionCache(ttl=60.0)
    async with maker() as db:
        season = await _seed_season(db)

    class _MarkDuringLoad:
        """적재 쿼리 '도중' 다른 코루틴이 주문 체결 후 mark_dirty — 이 적재는 그 커밋 이전 스냅샷."""

        def __call__(self):
            cache.mark_dirty()
            return maker()

    await cache.get(_MarkDuringLoad())
    async with maker() as db:
        await _seed_position(db, season)
    # 이전 적재 중에 들어온 dirty 가 유지되어야 다음 사용 시 재적재
    assert len((await cache.get(maker)).for_ticker("005930")) == 1


async def test_cache_reload_failure_keeps_old_snapshot(maker):
    clock = _Clock()
    cache = position_cache.PositionCache(ttl=5.0, clock=clock)
    async with maker() as db:
        season = await _seed_season(db)
        await _seed_position(db, season)
    assert len((await cache.get(maker)).for_ticker("005930")) == 1
    cache.mark_dirty()

    def broken():
        raise RuntimeError("db down")

    assert len((await cache.get(broken)).for_ticker("005930")) == 1  # 예외 없이 이전 스냅샷


async def test_cache_concurrent_gets_load_once(maker):
    cache = position_cache.PositionCache(ttl=5.0)
    counting = _CountingMaker(maker)
    async with maker() as db:
        await _seed_season(db)
    await asyncio.gather(*(cache.get(counting) for _ in range(5)))
    assert counting.calls == 1


# ---------------------------------------------------------------- liquidation parity
@pytest.fixture
def listener(maker, monkeypatch):
    monkeypatch.setattr(tick_listener, "AsyncSessionLocal", maker)
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(tick_listener.deps, "get_redis", lambda: redis)
    return redis


PARITY_CASES = [
    # side, lev, sl, tp, price
    ("LONG", 1, "98", None, "98"),      # STOP_LOSS
    ("LONG", 1, None, "105", "105"),    # TAKE_PROFIT
    ("LONG", 5, "90", None, "84"),      # MARGIN_CALL(우선) — ROI -80.03
    ("LONG", 1, "98", "105", "99"),     # 미발동
    ("SHORT", 1, "102", None, "102"),   # STOP_LOSS
    ("SHORT", 1, None, "95", "95"),     # TAKE_PROFIT
    ("SHORT", 5, "110", None, "116"),   # MARGIN_CALL(우선)
    ("SHORT", 1, "102", "95", "101"),   # 미발동
]


async def _trades(db) -> list[tuple]:
    rows = (await db.execute(select(GameTrade))).scalars().all()
    return [(t.closed_reason, t.exit_price, t.roi_pct, t.pnl_amount) for t in rows]


@pytest.mark.parametrize("side, lev, sl, tp, price", PARITY_CASES)
async def test_handle_tick_matches_legacy_liquidate_for_tick(side, lev, sl, tp, price, listener, monkeypatch):
    # 같은 시드를 가진 DB 두 개: 하나는 기존 DB 조회식, 하나는 캐시 후보식(_handle_tick)
    results = []
    for use_new in (False, True):
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            season = await _seed_season(db)
            await _seed_position(db, season, side=side, lev=lev, sl=sl, tp=tp)
        if use_new:
            monkeypatch.setattr(tick_listener, "AsyncSessionLocal", mk)
            position_cache.reset_cache()
            await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": float(price)}))
        else:
            async with mk() as db:
                await liquidation_service.liquidate_for_tick(db, "005930", Decimal(price))
        async with mk() as db:
            results.append((await _trades(db), [p.status for p in (await db.execute(select(GamePosition))).scalars()]))
        await engine.dispose()
    assert results[0] == results[1]


async def test_handle_tick_no_candidates_opens_no_db_session(maker, listener, monkeypatch):
    async with maker() as db:
        season = await _seed_season(db)
        await _seed_position(db, season, sl="98")
    await position_cache.cache.get(maker)  # 캐시 워밍
    monkeypatch.setattr(tick_listener, "AsyncSessionLocal", _boom_maker)
    for p in (99, 100, 101, 99.5):
        await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": p}))
    assert tick_listener.latest_tick()[1] == Decimal("99.5")


async def test_handle_tick_every_tick_checked_and_cache_dirtied_after_close(maker, listener):
    async with maker() as db:
        season = await _seed_season(db)
        uid, pos = await _seed_position(db, season, sl="98")
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 99}))
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 97.5}))  # 손절가 통과 틱
    async with maker() as db:
        assert (await db.get(GamePosition, pos.id)).status == "CLOSED"
    # 청산 후 mark_dirty → 다음 사용 시 재적재되어 후보에서 사라짐
    snap = await position_cache.cache.get(maker)
    assert snap.for_ticker("005930") == []


async def test_handle_tick_stale_cache_already_closed_is_safe(maker, listener):
    async with maker() as db:
        season = await _seed_season(db)
        _, pos = await _seed_position(db, season, sl="98")
    await position_cache.cache.get(maker)  # OPEN 상태로 캐시
    async with maker() as db:  # 다른 프로세스(정산 등)가 이미 닫음 — 캐시는 모름
        await db.execute(update(GamePosition).where(GamePosition.id == pos.id).values(status="CLOSED"))
        await db.commit()
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 97}))
    async with maker() as db:
        assert await _trades(db) == []  # DB 가 OPEN 아님 확인 → 청산 없음
    assert tick_listener._get_fanout_queue().empty()


# ---------------------------------------------------------------- broadcast conflation
async def test_broadcast_once_sends_only_latest_of_many_ticks(maker, listener, monkeypatch):
    async with maker() as db:
        await _seed_season(db)
    sent = []

    async def fake_broadcast(payload):
        sent.append(payload)

    monkeypatch.setattr(tick_listener.manager, "broadcast", fake_broadcast)
    for i in range(10):
        await tick_listener._handle_tick(json.dumps(
            {"ticker": "005930", "price": 100 + i, "timestamp": f"t{i}"}))
    assert sent == []  # 리스너는 직접 전송하지 않음
    assert await tick_listener.broadcast_once() is True
    assert sent == [{"type": "tick", "ticker": "005930", "price": 109, "timestamp": "t9"}]
    assert await tick_listener.broadcast_once() is False  # 새 틱 없음 → 0회
    assert len(sent) == 1


async def test_broadcast_loop_uses_interval_and_stops(maker, listener, monkeypatch):
    calls = []

    async def fake_once():
        calls.append(1)
        return False

    monkeypatch.setattr(tick_listener, "broadcast_once", fake_once)
    stop = asyncio.Event()
    task = asyncio.create_task(tick_listener.broadcast_loop(stop, interval=0.01))
    for _ in range(100):
        if len(calls) >= 3:
            break
        await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(task, 1)
    assert len(calls) >= 3


def test_interval_env_defaults(monkeypatch):
    monkeypatch.delenv("GAME_WS_TICK_INTERVAL_SEC", raising=False)
    monkeypatch.delenv("GAME_WS_PNL_INTERVAL_SEC", raising=False)
    assert tick_listener.tick_interval() == 0.25
    assert tick_listener.pnl_interval() == 1.0
    monkeypatch.setenv("GAME_WS_TICK_INTERVAL_SEC", "0.5")
    monkeypatch.setenv("GAME_WS_PNL_INTERVAL_SEC", "bad")
    assert tick_listener.tick_interval() == 0.5
    assert tick_listener.pnl_interval() == 1.0


# ---------------------------------------------------------------- pnl conflation
async def test_push_pnl_once_no_db_updates_rank_and_sends(maker, listener, monkeypatch):
    async with maker() as db:
        season = await _seed_season(db)
        uid, pos = await _seed_position(db, season, bonus="1000000")
    await position_cache.cache.get(maker)  # 캐시 워밍 후 DB 차단
    monkeypatch.setattr(tick_listener, "AsyncSessionLocal", _boom_maker)
    sent = []

    async def fake_send(user_id, payload):
        sent.append((user_id, payload))

    monkeypatch.setattr(tick_listener.manager, "send_to_user", fake_send)
    monkeypatch.setattr(tick_listener.manager, "user_ids", lambda: [uid])
    ranks = []
    real_update = tick_listener.ranking_service.update_rank

    async def spy_update(redis, season_id, user_id, roi, **kw):
        ranks.append((season_id, user_id, roi, kw.get("season_window")))
        await real_update(redis, season_id, user_id, roi, **kw)

    monkeypatch.setattr(tick_listener.ranking_service, "update_rank", spy_update)
    for p in (101, 102, 110):
        await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": p}))
    assert await tick_listener.push_pnl_once() is True
    assert len(ranks) == 1 and ranks[0][1] == uid and ranks[0][3] is not None  # 주간 포함(season_window)
    # 원금 11M: 현금 9M + 원금 1M×(1+9.97%) = 10,099,700 → ROI ≈ -8.18%
    assert ranks[0][2] == Decimal("-8.1845")
    assert sent == [(uid, {"type": "position_pnl", "position_id": str(pos.id),
                           "roi_pct": 9.97, "pnl_amount": 99700.0})]
    assert await listener.zscore(f"game:season:{season.id}:ranking", str(uid)) == pytest.approx(-8.1845)
    assert await tick_listener.push_pnl_once() is False  # 새 가격 없음 → 0회
    assert len(sent) == 1 and len(ranks) == 1


async def test_push_pnl_skips_rank_after_season_end(maker, listener, monkeypatch):
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    async with maker() as db:
        season = await _seed_season(db, end_at=past)
        uid, _ = await _seed_position(db, season)
    calls = []

    async def spy_update(*a, **k):
        calls.append(a)

    monkeypatch.setattr(tick_listener.ranking_service, "update_rank", spy_update)
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 101}))
    await tick_listener.push_pnl_once()
    assert calls == []  # 종료 시각 지난 시즌(정산 반영 전 캐시)은 랭킹 미갱신


async def test_fanout_queue_no_longer_carries_ticks(maker, listener):
    async with maker() as db:
        await _seed_season(db)
    await tick_listener._handle_tick(json.dumps({"ticker": "005930", "price": 100}))
    assert tick_listener._get_fanout_queue().empty()

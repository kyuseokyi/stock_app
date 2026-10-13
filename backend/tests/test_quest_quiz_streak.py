"""트레이딩 게임 Phase 5b — 퀘스트·아카데미·야간 퀴즈·Streak·기능 플래그 테스트."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy import event, select, update
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


def _redis():
    """서비스 호출용 빈 fakeredis(최신가 없음)."""
    return fake_aioredis.FakeRedis(decode_responses=True)


async def _set_latest(redis, ticker: str, price) -> None:
    """market_clock.read_latest 가 읽는 stock:latest:{ticker} 포맷({price, ts})으로 기록."""
    import json
    import time
    await redis.set(f"stock:latest:{ticker}", json.dumps({"price": float(price), "ts": time.time()}))


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

    await reward_service.grant_cash(session, acc, Decimal("500000"), redis=_redis())
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


async def test_grant_cash_uses_db_current_roi_not_stale_object(maker):
    async with maker() as a, maker() as b:
        user = await _seed_user(a)
        season = await _seed_season(a)
        stale = await _seed_account(a, user, season, cash=Decimal("10500000"), roi=Decimal("5"))
        # 다른 세션이 ROI -20 / 자산 8,000,000 으로 갱신(A 의 객체는 오래된 값 유지)
        await b.execute(
            update(GameAccount).where(GameAccount.id == stale.id).values(
                current_roi=Decimal("-20"),
                cash_balance=Decimal("8000000"),
                total_asset=Decimal("8000000"),
            )
        )
        await b.commit()
        assert stale.current_roi == Decimal("5")

        await reward_service.grant_cash(a, stale, Decimal("500000"), redis=_redis())
        await a.commit()

    async with maker() as c:
        fresh = await c.get(GameAccount, stale.id)
        assert fresh.bonus_cash == Decimal("625000.00")  # 500000/0.8 (DB ROI -20 기준)


async def test_close_position_keeps_concurrent_reward_in_total_asset(maker):
    async with maker() as a, maker() as b:
        user = await _seed_user(a)
        season = await _seed_season(a)
        acc = await _seed_account(a, user, season)
        pos = await order_engine.open_position(
            a, account=acc, side="LONG", ratio=Decimal("0.25"), leverage=1,
            entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )
        # 다른 세션이 보상 지급(+500000) 후 커밋 — A 의 acc 는 오래된 값
        acc_b = await b.get(GameAccount, acc.id)
        r = _redis()
        await _set_latest(r, "005930", Decimal("100"))  # 보유 포지션 → 실시간 시세로 원금 산정
        await reward_service.grant_cash(b, acc_b, Decimal("500000"), redis=r)
        await b.commit()

        await order_engine.close_position(a, position_id=pos.id, exit_price=Decimal("100"), reason="MANUAL")

    async with maker() as c:
        fresh = await c.get(GameAccount, acc.id)
        assert fresh.cash_balance > Decimal("10400000")
        assert fresh.total_asset == fresh.cash_balance


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


async def test_grant_cash_with_open_position_uses_live_roi(session):
    from apps.trading_game.services import ranking_service
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = await _seed_account(session, user, season)  # 현금 10M, 실현 ROI 0%
    pos = await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("1.0"), leverage=1,
        entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    redis = _redis()
    price = Decimal("20")
    await _set_latest(redis, "005930", price)
    await session.refresh(acc)
    before = ranking_service.compute_live_roi(acc.cash_balance, pos, price, reward_service.principal(acc))
    assert before < Decimal("-79")  # 실시간 약 -80% (저장 ROI 는 0%)

    await reward_service.grant_cash(session, acc, Decimal("2100000"), redis=redis)
    await session.commit()
    await session.refresh(acc)
    after = ranking_service.compute_live_roi(acc.cash_balance, pos, price, reward_service.principal(acc))
    assert abs(after - before) <= Decimal("0.0001")

    await order_engine.close_position(session, position_id=pos.id, exit_price=price, reason="MANUAL")
    await session.refresh(acc)
    assert abs(acc.current_roi - before) <= Decimal("0.01")


async def test_grant_cash_open_position_without_price_raises(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = await _seed_account(session, user, season)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"), leverage=1,
        entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    with pytest.raises(reward_service.RewardUnavailable):
        await reward_service.grant_cash(session, acc, Decimal("500000"), redis=_redis())


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


async def test_flag_cache_hit_ignores_db_change(session):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    assert await feature_flag_service.is_enabled(session, redis, "QUIZ") is True  # 캐시 적재
    await session.merge(GameFeatureFlag(key="QUIZ", enabled=False))  # Redis 를 거치지 않는 직접 변경
    await session.commit()
    assert await feature_flag_service.is_enabled(session, redis, "QUIZ") is True  # 캐시 히트


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


def test_kst_today_midnight_boundary_for_streak():
    from apps.trading_game.services import coach_service

    utc_late = datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc)  # KST 10/13 00:30
    assert coach_service.kst_today(utc_late) == date(2026, 10, 13)
    assert coach_service.kst_today(datetime(2026, 10, 12, 14, 59, tzinfo=timezone.utc)) == date(2026, 10, 12)


async def test_touch_uses_kst_date_at_midnight_boundary(session):
    from apps.trading_game.services import coach_service

    redis = fake_aioredis.FakeRedis(decode_responses=True)
    user = await _seed_user(session)
    kst = coach_service.kst_today(datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc))
    r = await streak_service.touch(session, redis, user.id, today=kst)
    assert r.last_activity_date == date(2026, 10, 13)


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
    assert r.json() == {"current_streak": 0, "highest_streak": 0, "last_activity_date": None, "enabled": True, "rewards": []}

    async with maker() as db:
        await streak_service.touch(db, fake_redis, user.id, today=D)
        await feature_flag_service.set_flag(db, fake_redis, "STREAK", False)
    r = await client.get("/api/game/streak/my")
    assert r.json() == {"current_streak": 1, "highest_streak": 1, "last_activity_date": "2026-10-13", "enabled": False, "rewards": []}


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
    assert indicators.golden_cross_within([100.0] * 21 + [110.0]) is False  # 22봉 < slow+within(23)


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
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS", redis=_redis())
    assert e.value.code == "QUEST_NOT_COMPLETED"

    await _open(session, user, sl=Decimal("98"))
    row, acc, _ = await quest_service.claim(session, user.id, "Q1_STOP_LOSS", redis=_redis())
    assert row.claimed_at is not None
    assert acc.season_id == season.id
    assert acc.cash_balance == Decimal("10500000")
    assert acc.bonus_cash == Decimal("500000.00")  # ROI 0% → 같은 금액

    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS", redis=_redis())
    assert e.value.code == "ALREADY_CLAIMED"


async def test_claim_double_claim_guard_with_stale_session(maker, closes_stub):
    # 세션 A 의 identity map 에 claimed_at=None 이 남은 채로 B 가 먼저 수령 → A 는 조건부 UPDATE 가드로 차단
    async with maker() as setup:
        user = await _seed_user(setup)
        await _seed_season(setup)
        await _open(setup, user, sl=Decimal("98"))
    async with maker() as a, maker() as b:
        stale = await a.get(UserQuestProgress, (user.id, "Q1_STOP_LOSS"))
        assert stale.claimed_at is None
        await quest_service.claim(b, user.id, "Q1_STOP_LOSS", redis=_redis())
        assert stale.claimed_at is None  # A 의 메모리 객체는 오래된 값
        with pytest.raises(quest_service.QuestError) as e:
            await quest_service.claim(a, user.id, "Q1_STOP_LOSS", redis=_redis())
        assert e.value.code == "ALREADY_CLAIMED"
    async with maker() as c:
        acc = (await c.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
        assert acc.cash_balance == Decimal("10500000")  # 1회만 지급


async def test_claim_without_active_season_keeps_unclaimed(session, closes_stub):
    user = await _seed_user(session)
    await _seed_season(session, status="FINISHED")
    await _open(session, user, sl=Decimal("98"))
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS", redis=_redis())
    assert e.value.code == "NO_ACTIVE_SEASON"
    assert (await _progress(session, user, "Q1_STOP_LOSS")).claimed_at is None


async def test_claim_expired_active_season_is_not_reward_eligible(session, closes_stub):
    user = await _seed_user(session)
    season = await _seed_season(session)
    season.end_at = datetime.now(timezone.utc) - timedelta(minutes=1)  # ACTIVE 이지만 종료시각 경과(정산 대기)
    await session.commit()
    await _open(session, user, sl=Decimal("98"))
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS", redis=_redis())
    assert e.value.code == "NO_ACTIVE_SEASON"
    assert (await _progress(session, user, "Q1_STOP_LOSS")).claimed_at is None


async def test_claim_price_unavailable_keeps_unclaimed(session, closes_stub):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = await _seed_account(session, user, season)
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"), leverage=1,
        entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    cash_before, acc_id, uid = acc.cash_balance, acc.id, user.id  # rollback 후 expire 대비
    await _open(session, user, sl=Decimal("98"))
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, uid, "Q1_STOP_LOSS", redis=_redis())  # 최신가 없음
    assert e.value.code == "PRICE_UNAVAILABLE"
    row = await session.get(UserQuestProgress, (uid, "Q1_STOP_LOSS"), populate_existing=True)
    assert row.completed_at is not None and row.claimed_at is None
    fresh = await session.get(GameAccount, acc_id, populate_existing=True)
    assert fresh.cash_balance == cash_before and fresh.bonus_cash == Decimal("0")


async def test_claim_badge_without_season(session, closes_stub):
    user = await _seed_user(session)
    for _ in range(3):
        await _open(session, user, ratio=0.25)
    row, acc, badge = await quest_service.claim(session, user.id, "Q3_SMALL_SIZE", redis=_redis())
    assert acc is None and row.claimed_at is not None
    assert badge is not None and badge.badge_code == "PRINCIPLED"
    assert await session.get(UserBadge, (user.id, "PRINCIPLED")) is not None


async def test_claim_unknown_quest(session):
    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, 1, "NOPE", redis=_redis())
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


async def test_academy_wrong_after_pass_keeps_unlock(session):
    user = await _seed_user(session)
    _, unlocked = await academy_service.submit(session, user.id, ALL_CORRECT)
    assert unlocked is True
    passed_at = (await session.get(UserAcademy, user.id)).passed_at

    wrong = {q.id: (q.answer + 1) % len(q.choices) for q in academy_service.QUESTIONS}
    _, unlocked = await academy_service.submit(session, user.id, wrong)
    assert unlocked is True
    await session.refresh(await session.get(UserAcademy, user.id))
    row = await session.get(UserAcademy, user.id)
    assert row.unlocked_leverage_5x is True and row.passed_at == passed_at and row.attempts == 2


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


# ---------------------------------------------------------------- order hooks
async def test_rsi_timeout_marks_closes_unavailable(api, maker, order_env, fake_redis, monkeypatch):
    async def slow(*a, **k):
        await asyncio.sleep(5)

    monkeypatch.setattr(orders_router.rsi_service, "current_rsi", slow)
    monkeypatch.setattr(orders_router, "RSI_TIMEOUT_SECONDS", 0.05)
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
    set_user(user)
    r = await client.post("/api/game/orders", json=_order(season.id))
    assert r.status_code == 201, r.text
    today = datetime.now(rsi_service.KST).date()
    assert await fake_redis.get(rsi_service._cache_key("005930", today) + ":neg") == "1"


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
    res = await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=5))
    assert res.correct is True and res.rewarded is True and res.timed_out is False
    acc = (await session.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
    await session.refresh(acc)
    assert acc.cash_balance == Decimal("10200000")
    with pytest.raises(quiz_service.QuizError) as e:
        await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=6))
    assert e.value.code == "ALREADY_SUBMITTED"


async def test_submit_not_served(session):
    user = await _seed_user(session)
    q = (await _seed_quizzes(session, 1))[0]
    with pytest.raises(quiz_service.QuizError) as e:
        await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0)
    assert e.value.code == "QUIZ_NOT_SERVED"


@pytest.mark.parametrize("elapsed, timed_out", [(13, False), (13.5, True)])
async def test_submit_time_limit(session, elapsed, timed_out):
    user = await _seed_user(session)
    await _seed_season(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=elapsed))
    assert res.timed_out is timed_out
    assert res.correct is (not timed_out)
    assert res.rewarded is (not timed_out)


async def test_submit_wrong_no_reward(session):
    user = await _seed_user(session)
    await _seed_season(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "DOWN", redis=_redis(), now=T0 + timedelta(seconds=3))
    assert res.correct is False and res.rewarded is False


async def test_daily_reward_limit_three(session):
    user = await _seed_user(session)
    await _seed_season(session)
    await _seed_quizzes(session, 5)
    rewarded = []
    for _ in range(4):
        q = await quiz_service.serve_random(session, user.id, now=T0)
        res = await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=2))
        rewarded.append(res.rewarded)
    assert rewarded == [True, True, True, False]
    # 다음 날(KST)에는 다시 보상
    t1 = T0 + timedelta(days=1)
    q = await quiz_service.serve_random(session, user.id, now=t1)
    assert (await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=t1 + timedelta(seconds=2))).rewarded is True


async def test_submit_correct_without_season_no_reward(session):
    user = await _seed_user(session)
    q = (await _seed_quizzes(session, 1))[0]
    await quiz_service.serve_random(session, user.id, now=T0)
    res = await quiz_service.submit(session, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=2))
    assert res.correct is True and res.rewarded is False
    assert (await session.execute(select(GameAccount))).scalars().all() == []


async def test_submit_already_submitted_guard_with_stale_session(maker):
    # 세션 A 의 identity map 에 submitted_at=None 이 남은 채로 B 가 먼저 제출 → A 는 조건부 UPDATE 가드로 차단
    async with maker() as setup:
        user = await _seed_user(setup)
        await _seed_season(setup)
        q = (await _seed_quizzes(setup, 1))[0]
        await quiz_service.serve_random(setup, user.id, now=T0)
    async with maker() as a, maker() as b:
        stale = await a.get(UserQuizAttempt, (user.id, q.id))
        assert stale.submitted_at is None
        res = await quiz_service.submit(b, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=2))
        assert res.rewarded is True
        assert stale.submitted_at is None  # A 의 메모리 객체는 오래된 값
        with pytest.raises(quiz_service.QuizError) as e:
            await quiz_service.submit(a, user.id, q.id, "UP", redis=_redis(), now=T0 + timedelta(seconds=3))
        assert e.value.code == "ALREADY_SUBMITTED"
    async with maker() as c:
        acc = (await c.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
        assert acc.cash_balance == Decimal("10200000")  # 1회만 지급


def test_masked_snapshot_normalizes_and_drops_date():
    snap = [
        {"date": "2026-01-01", "open": 50.0, "high": 60.0, "low": 40.0, "close": 50.0, "volume": 1000},
        {"date": "2026-01-02", "open": 50.0, "high": 75.0, "low": 49.0, "close": 75.0, "volume": 2000},
    ]
    out = quiz_service.masked_snapshot(snap)
    assert out == [
        {"open": 100.0, "high": 120.0, "low": 80.0, "close": 100.0, "volume": 1000},
        {"open": 100.0, "high": 150.0, "low": 98.0, "close": 150.0, "volume": 2000},
    ]
    assert "date" in snap[0]  # 원본 불변
    assert quiz_service.masked_snapshot([]) == []
    zero = quiz_service.masked_snapshot([{"date": "d", "open": 1, "high": 1, "low": 1, "close": 0, "volume": 5}])
    assert zero == [{"open": 1, "high": 1, "low": 1, "close": 0, "volume": 5}]


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
    assert set(data) == {"id", "chart_snapshot", "time_limit_sec"}
    assert data["time_limit_sec"] == 10
    assert all("date" not in c for c in data["chart_snapshot"])
    assert data["chart_snapshot"][0]["close"] == 100

    r = await client.post(f"/api/game/quiz/{data['id']}/submit", json={"choice": "UP"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["correct"] is True and body["answer"] == "UP" and body["rewarded"] is True
    assert body["explanation"] == "해설0" and body["streak"]["current_streak"] == 1
    assert body["ticker"] == "005930" and body["base_date"] == "2026-01-01"

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


def test_make_quiz_skips_zero_close_and_extreme_moves():
    base = [100.0] * 60 + [100.0] * 4 + [108.0]
    assert gen.make_quiz("005930", _candles(base), 59) is not None  # 대조군
    zero = list(base)
    zero[30] = 0.0  # 윈도우 내 종가 0
    assert gen.make_quiz("005930", _candles(zero), 59) is None
    zero_base = list(base)
    zero_base[59] = 0.0  # 기준일 종가 0 → ZeroDivisionError 금지
    assert gen.make_quiz("005930", _candles(zero_base), 59) is None
    spike = [100.0] * 30 + [140.0] * 35 + [150.0]  # +40% 하루 급등
    assert gen.make_quiz("005930", _candles(spike[:60] + [140.0] * 4 + [150.0]), 59) is None
    ok = [100.0] * 30 + [129.0] * 30 + [129.0] * 4 + [140.0]  # +29% 허용, 미래 +8.5%
    q = gen.make_quiz("005930", _candles(ok), 59)
    assert q is not None and q["answer"] == "UP"


def test_make_quiz_boundary_one_percent_and_down():
    up = gen.make_quiz("005930", _candles([100.0] * 64 + [101.0]), 59)
    assert up["answer"] == "UP" and up["actual_change"] == Decimal("1.00")
    down = gen.make_quiz("005930", _candles([100.0] * 64 + [98.0]), 59)
    assert down["answer"] == "DOWN" and down["actual_change"] == Decimal("-2.00")


async def test_generate_dedups_within_run(maker):
    closes = [100.0 + (i % 7) * 3 for i in range(66)]  # 유효 base_idx 는 59, 60 둘뿐
    candles = _candles(closes)
    created, skipped = await gen.generate(
        2, rng=random.Random(0), fetch_tickers=lambda: ["005930"],
        fetch_candles=lambda t: candles, session_factory=maker)
    assert created == 2 and skipped == 0

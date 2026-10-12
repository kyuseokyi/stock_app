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

        await reward_service.grant_cash(a, stale, Decimal("500000"))
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
        await reward_service.grant_cash(b, acc_b, Decimal("500000"))
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
    row, acc, _ = await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
    assert row.claimed_at is not None
    assert acc.season_id == season.id
    assert acc.cash_balance == Decimal("10500000")
    assert acc.bonus_cash == Decimal("500000.00")  # ROI 0% → 같은 금액

    with pytest.raises(quest_service.QuestError) as e:
        await quest_service.claim(session, user.id, "Q1_STOP_LOSS")
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
        await quest_service.claim(b, user.id, "Q1_STOP_LOSS")
        assert stale.claimed_at is None  # A 의 메모리 객체는 오래된 값
        with pytest.raises(quest_service.QuestError) as e:
            await quest_service.claim(a, user.id, "Q1_STOP_LOSS")
        assert e.value.code == "ALREADY_CLAIMED"
    async with maker() as c:
        acc = (await c.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
        assert acc.cash_balance == Decimal("10500000")  # 1회만 지급


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
    row, acc, badge = await quest_service.claim(session, user.id, "Q3_SMALL_SIZE")
    assert acc is None and row.claimed_at is not None
    assert badge is not None and badge.badge_code == "PRINCIPLED"
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

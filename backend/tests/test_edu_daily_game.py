"""교육용 합성 종가 게임 — 엔진·정산 규칙·하루 1회 제출·OFF 응답·관리자·Celery (명세 7절 백엔드 체크리스트)."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from fastapi import HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user, get_optional_user
from shared.database import get_db
from shared.game_models import (
    EduGameAccount, EduGameCandle, EduGameDailyAction, EduGameSeason, GameFeatureFlag, UserAcademy, UserStreak,
)
from shared.models import Base, User, UserRole
from apps.trading_game import deps
from apps.trading_game.main import app
from apps.trading_game.services import edu_game_service as svc
from apps.trading_game.services import edu_synthetic_engine as eng

KST = svc.KST
ALREADY = {"detail": {"code": "ALREADY_PARTICIPATED_TODAY", "message": svc.MSG_ALREADY}}


# ---------------------------------------------------------------- fixtures
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
def fake_redis(monkeypatch):
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(deps, "get_redis", lambda: redis)
    return redis


@pytest.fixture
async def api(maker, fake_redis):
    """(client, set_user) — set_user(None) 이면 비로그인(필수 인증 401, 선택 인증 None)."""
    state: dict = {"user": None}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        if state["user"] is None:
            raise HTTPException(401, "인증이 필요합니다.")
        return state["user"]

    async def _optional():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_optional_user] = _optional
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, (lambda u: state.__setitem__("user", u))
    app.dependency_overrides.clear()


async def _user(maker, *, role=UserRole.FREE, nickname="플레이어") -> User:
    async with maker() as db:
        u = User(nickname=nickname, role=role, is_active=True)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        return u


async def _account(maker, user_id: int) -> EduGameAccount:
    async with maker() as db:
        return (await db.execute(select(EduGameAccount).where(EduGameAccount.user_id == user_id))).scalar_one()


async def _season(maker) -> EduGameSeason:
    async with maker() as db:
        return (await db.execute(select(EduGameSeason).where(EduGameSeason.status == "ACTIVE"))).scalar_one()


async def _advance(maker, **kw) -> dict:
    async with maker() as db:
        return await svc.advance_day_and_settle(db, force=kw.pop("force", True), **kw)


def _patch_next(monkeypatch, o: int, h: int, lo: int, c: int) -> None:
    """다음 봉 OHLC 를 고정(정산 판정 검증용) — 나머지 필드는 진짜 엔진 값."""
    real = eng.generate_next_candle

    def fake(seed, sid, history, regime, days_left, override=None):
        bar, r, d = real(seed, sid, history, regime, days_left, override)
        bar.update(open=o, high=h, low=lo, close=c)
        return bar, r, d

    monkeypatch.setattr(eng, "generate_next_candle", fake)


async def _close(client) -> int:
    return (await client.get("/api/game/edu/state")).json()["today"]["close"]


def _enter(side="LONG", ratio=0.5, lev=1, sl=5, tp=10) -> dict:
    return {"action": f"ENTER_{side}", "ratio": ratio, "leverage": lev, "stop_loss_pct": sl, "take_profit_pct": tp}


# ---------------------------------------------------------------- 엔진(순수 함수)
@pytest.mark.parametrize("price, tick", [
    (1_999, 1), (2_000, 5), (4_999, 5), (5_000, 10), (19_999, 10), (20_000, 50), (49_999, 50),
    (50_000, 100), (199_999, 100), (200_000, 500), (499_999, 500), (500_000, 1_000),
])
def test_tick_size_table(price, tick):
    assert eng.tick_size(price) == tick


@pytest.mark.parametrize("raw, expected", [(50_049, 50_000), (50_050, 50_100), (49_974, 49_950), (0.2, 1), (-5, 1)])
def test_round_tick(raw, expected):
    assert eng.round_tick(raw) == expected


def _assert_bar_ok(b: dict) -> None:
    for k in ("open", "high", "low", "close"):
        v = b[k]
        assert v >= 1 and v % eng.tick_size(v) == 0, (k, v)
    assert b["low"] <= min(b["open"], b["close"]) <= max(b["open"], b["close"]) <= b["high"]
    assert b["volume"] > 0
    assert b["poc_price"] and b["support_price"] and b["resistance_price"]
    assert b["pattern_tag"] and b["coach_comment"]


@pytest.mark.parametrize("seed", ["a" * 64, "seed-2", "seed-3", "seed-4"])
def test_initial_120_candles_invariants(seed):
    start = date(2026, 11, 23)  # 월요일
    bars, regime, days_left = eng.generate_initial_candles(seed, 7, start)
    assert len(bars) == 120 and [b["day_index"] for b in bars] == list(range(1, 121))
    for b in bars:
        _assert_bar_ok(b)
        assert b["display_date"] < start and b["display_date"].weekday() < 5
    dates = [b["display_date"] for b in bars]
    assert dates == sorted(dates) and len(set(dates)) == 120
    assert bars[-1]["display_date"] == date(2026, 11, 20)  # 시작일 직전 평일(금)
    assert regime in eng.REGIMES and days_left >= 0
    # 지지 ≤ 종가 ≤ 저항(스윙 레벨 또는 최근 20봉 최저·최고)
    last = bars[-1]
    assert last["support_price"] <= last["close"] <= last["resistance_price"]


def test_generation_is_deterministic_per_seed_and_day():
    a, *_ = eng.generate_initial_candles("k1", 1, date(2026, 11, 23))
    b, *_ = eng.generate_initial_candles("k1", 1, date(2026, 11, 23))
    c, *_ = eng.generate_initial_candles("k2", 1, date(2026, 11, 23))
    d, *_ = eng.generate_initial_candles("k1", 2, date(2026, 11, 23))  # 다른 시즌 id
    assert a == b and a != c and a != d
    n1 = eng.generate_next_candle("k1", 1, a[-60:], "UPTREND", 3)
    n2 = eng.generate_next_candle("k1", 1, b[-60:], "UPTREND", 3)
    assert n1 == n2 and n1[0]["day_index"] == 121


def test_hmac_rng_uses_seed_key_not_server_secret():
    r1 = eng.day_rng("k", 1, 121).random()
    assert r1 == eng.day_rng("k", 1, 121).random()
    assert r1 != eng.day_rng("k", 1, 122).random() != eng.day_rng("j", 1, 121).random()


def test_next_candles_chain_invariants_and_weekday_dates():
    bars, regime, left = eng.generate_initial_candles("chain", 3, date(2026, 11, 23))
    seen = set()
    for _ in range(250):
        bar, regime, left = eng.generate_next_candle("chain", 3, bars[-60:], regime, left)
        _assert_bar_ok(bar)
        assert bar["display_date"] == eng.next_weekday(bars[-1]["display_date"])
        assert abs(bar["change_pct"]) <= Decimal("30.5")
        bars.append(bar)
        seen.add(bar["regime"])
    assert seen == set(eng.REGIMES)  # 4국면 모두 순환
    assert bars[120]["display_date"] == date(2026, 11, 23)


def test_regime_override_applies_next_bar():
    bars, *_ = eng.generate_initial_candles("ov", 1, date(2026, 11, 23))
    bar, regime, left = eng.generate_next_candle("ov", 1, bars[-60:], "ACCUMULATION", 6, "DOWNTREND")
    assert regime == "DOWNTREND" == bar["regime"] and eng.REGIME_MIN_DAYS - 1 <= left <= eng.REGIME_MAX_DAYS - 1


def test_poc_is_max_volume_zone():
    flat = [{"open": 100, "high": 101, "low": 99, "close": 100, "volume": 10} for _ in range(10)]
    heavy = [{"open": 150, "high": 151, "low": 149, "close": 150, "volume": 1_000} for _ in range(3)]
    poc = eng.compute_poc(flat + heavy)
    assert 145 <= poc <= 155


# ---------------------------------------------------------------- 정산 규칙(순수 함수)
D = Decimal


def test_pnl_long_short_and_loss_cap():
    assert svc.position_pnl("LONG", D(50000), D(55000), D(1000000), 2) == D("200000.00")
    assert svc.position_pnl("SHORT", D(50000), D(55000), D(1000000), 2) == D("-200000.00")
    assert svc.position_pnl("SHORT", D(50000), D(45000), D(1000000), 1) == D("100000.00")
    # 손실은 진입 금액까지
    assert svc.position_pnl("SHORT", D(50000), D(80000), D(1000000), 5) == D("-1000000.00")


def test_stop_take_prices_rounded_to_tick():
    assert svc.stop_take_prices("LONG", 50300, 5, 10) == (47800, 55300)  # 47785→47800(50), 55330→55300(100)
    assert svc.stop_take_prices("SHORT", 50000, 3, 5) == (51500, 47500)


def _settle(side, o, h, lo, c, *, entry=50000, size=1000000, lev=1, sl=47500, tp=55000):
    return svc.settle_on_candle(side, D(entry), D(size), lev, D(sl), D(tp), D(o), D(h), D(lo), D(c))


def test_settle_long_stop_loss_hit_by_low():
    st = _settle("LONG", 49000, 49500, 47000, 48000)
    assert st.closed and st.reason == "STOP_LOSS" and st.exit_price == D(47500) and st.pnl == D("-50000.00")
    assert "손절가 47,500원 도달" in st.note


def test_settle_long_take_profit_hit_by_high():
    st = _settle("LONG", 51000, 56000, 50500, 54000)
    assert st.closed and st.reason == "TAKE_PROFIT" and st.exit_price == D(55000) and st.pnl == D("100000.00")


def test_settle_both_hit_prefers_level_closer_to_open():
    near_sl = _settle("LONG", 48000, 56000, 47000, 50000)   # 시가→손절 500 < 시가→익절 7000
    near_tp = _settle("LONG", 54500, 56000, 47000, 50000)   # 시가→익절 500
    assert near_sl.reason == "STOP_LOSS" and near_tp.reason == "TAKE_PROFIT"


def test_settle_gap_fills_at_open():
    st = _settle("LONG", 46000, 46500, 45000, 46200)
    assert st.reason == "STOP_LOSS" and st.exit_price == D(46000) and "시가 갭" in st.note


def test_settle_short_rules():
    tp = _settle("SHORT", 49000, 49500, 44000, 46000, sl=52500, tp=45000)
    sl = _settle("SHORT", 51000, 53000, 50500, 52000, sl=52500, tp=45000)
    assert tp.reason == "TAKE_PROFIT" and tp.pnl == D("100000.00")
    assert sl.reason == "STOP_LOSS" and sl.pnl == D("-50000.00")


def test_settle_loss_cap_liquidates_without_negative_balance():
    st = _settle("SHORT", 80000, 81000, 79000, 80500, lev=5, sl=52500, tp=45000)
    assert st.closed and st.reason == "LIQUIDATED" and st.pnl == D("-1000000.00")


def test_settle_no_hit_marks_to_close():
    st = _settle("LONG", 50100, 51000, 49000, 50500)
    assert not st.closed and st.reason is None and st.pnl == D("10000.00")


def test_next_settlement_time():
    mon_morning = datetime(2026, 11, 23, 10, 0, tzinfo=KST)
    assert svc.next_settlement_at(mon_morning, None) == datetime(2026, 11, 23, 20, 0, tzinfo=KST)
    assert svc.next_settlement_at(mon_morning, date(2026, 11, 23)) == datetime(2026, 11, 24, 20, 0, tzinfo=KST)
    fri_night = datetime(2026, 11, 27, 21, 0, tzinfo=KST)
    assert svc.next_settlement_at(fri_night, None) == datetime(2026, 11, 30, 20, 0, tzinfo=KST)


# ---------------------------------------------------------------- state·부트스트랩
async def test_state_anonymous_bootstraps_season_with_120_candles(api, maker):
    client, set_user = api
    set_user(None)
    r = await client.get("/api/game/edu/state")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is True and body["logged_in"] is False
    assert body["today_submitted"] is False and body["account"] is None
    assert body["season"]["season_number"] == 1 and body["season"]["current_day_index"] == 120
    assert body["season"]["display_name"] == svc.DEFAULT_TITLE
    assert len(body["candles"]) == 120 and "regime" not in body["candles"][0]
    assert body["today"]["poc_price"] and body["today"]["support_price"] and body["today"]["resistance_price"]
    assert body["today"]["coach_comment"]
    assert body["crowd"] == {"total": 0, "long": 0, "short": 0, "watch": 0,
                             "long_pct": 0.0, "short_pct": 0.0, "watch_pct": 0.0}
    assert body["disclaimer"] == svc.DISCLAIMER
    assert body["options"]["leverages"] == [1, 2, 5] and body["options"]["leverage_5x_unlocked"] is False

    await client.get("/api/game/edu/state")  # 두 번째 조회는 새로 만들지 않는다
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(EduGameSeason))).scalar() == 1
        assert (await db.execute(select(func.count()).select_from(EduGameCandle))).scalar() == 120


async def test_only_one_active_season_enforced_by_db(maker):
    async with maker() as db:
        await svc.get_or_create_active_season(db, date(2026, 11, 23))
    async with maker() as db:
        db.add(EduGameSeason(season_number=99, synthetic_code="SYN-99", title="t", theme_category="c",
                             seed_key="x", status="ACTIVE", start_date=date(2026, 11, 23)))
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_bootstrap_loser_rereads_existing_season(maker, monkeypatch):
    """동시 부트스트랩에서 진 요청 — INSERT 가 유일 제약에 걸리면 rollback 후 이미 생긴 시즌을 돌려준다."""
    async with maker() as db:
        first = await svc.get_or_create_active_season(db, date(2026, 11, 23))
    calls = {"n": 0}
    real = svc._active_season

    async def racing(db, *, lock=None):  # 첫 조회는 '아직 없음'으로 보이게(경쟁 상황 재현)
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, lock=lock)

    monkeypatch.setattr(svc, "_active_season", racing)
    async with maker() as db:
        again = await svc.get_or_create_active_season(db, date(2026, 11, 23))
    assert again.id == first.id


async def test_hidden_name_season_shows_blind_label(api, maker):
    client, set_user = api
    async with maker() as db:
        await svc.start_new_season(db, title="비밀 테마", theme_category="블라인드", hide_name=True, start_price=100000)
    body = (await client.get("/api/game/edu/state")).json()
    assert body["season"]["display_name"] == "블라인드 교육 차트 #1"
    assert body["season"]["title"] is None and body["season"]["theme_category"] is None
    assert 80_000 <= body["candles"][0]["open"] <= 120_000


# ---------------------------------------------------------------- 하루 1회 제출
async def test_second_action_same_day_index_is_409(api, maker):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    r = await client.post("/api/game/edu/action", json=_enter())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["action"]["action_type"] == "ENTER_LONG" and body["action"]["side"] == "LONG"
    assert body["account"]["position"]["side"] == "LONG"
    assert body["account"]["cash_balance"] == 5_000_000.0

    r2 = await client.post("/api/game/edu/action", json={"action": "FULL_CLOSE"})
    assert r2.status_code == 409 and r2.json() == ALREADY
    state = (await client.get("/api/game/edu/state")).json()
    assert state["today_submitted"] is True and state["today_action"]["action_type"] == "ENTER_LONG"
    assert state["crowd"]["long"] == 1 and state["crowd"]["long_pct"] == 100.0


async def test_db_unique_constraint_also_returns_409(api, maker):
    """계좌 last_action_day_index 판정을 지나쳐도(경쟁 상황) (account_id, day_index) 유일 제약이 같은 409 로 막는다."""
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    await client.get("/api/game/edu/state")
    season = await _season(maker)
    async with maker() as db:
        acc = EduGameAccount(user_id=u.id, season_id=season.id)
        db.add(acc)
        await db.flush()
        db.add(EduGameDailyAction(account_id=acc.id, season_id=season.id, user_id=u.id,
                                  day_index=season.current_day_index, action_date=date.today(),
                                  action_type="HOLD_WATCH", execution_price=Decimal(1)))
        await db.commit()  # last_action_day_index 는 비워 둔 채
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    assert r.status_code == 409 and r.json() == ALREADY
    acc = await _account(maker, u.id)
    assert acc.bonus_cash == 0 and acc.participation_days == 0  # 롤백되어 보너스도 없다


async def test_advance_reopens_participation(api, maker):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    assert (await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})).status_code == 200
    res = await _advance(maker)
    assert res["status"] == "advanced" and res["day_index"] == 121
    state = (await client.get("/api/game/edu/state")).json()
    assert state["season"]["current_day_index"] == 121 and state["today_submitted"] is False
    assert len(state["candles"]) == 120 and state["candles"][-1]["day_index"] == 121
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    assert r.status_code == 200 and r.json()["action"]["day_index"] == 121


async def test_hold_watch_counts_participation_streak_and_bonus(api, maker):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bonus_cash_awarded"] == 10000.0 and body["streak"] == 1
    assert body["action"]["side"] is None
    acc = await _account(maker, u.id)
    assert acc.participation_days == 1 and acc.bonus_cash == Decimal("10000")
    assert acc.cash_balance == Decimal("10010000") and acc.current_roi == 0  # 원금 조정분 — ROI 영향 없음
    async with maker() as db:
        streak = await db.get(UserStreak, u.id)
        assert streak.current_streak == 1 and streak.last_activity_date == svc.now_kst().date()
    state = (await client.get("/api/game/edu/state")).json()
    assert state["today_submitted"] is True and state["crowd"]["watch"] == 1


async def test_streak_flag_off_still_accepts_action(api, maker):
    client, set_user = api
    async with maker() as db:
        db.add(GameFeatureFlag(key="STREAK", enabled=False))
        await db.commit()
    set_user(await _user(maker))
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    assert r.status_code == 200 and r.json()["streak"] is None


async def test_action_not_allowed_and_validation(api, maker):
    client, set_user = api
    set_user(await _user(maker))
    r = await client.post("/api/game/edu/action", json={"action": "KEEP_POS"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ACTION_NOT_ALLOWED"
    r = await client.post("/api/game/edu/action", json={"action": "ENTER_LONG", "ratio": 0.5})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_ORDER"
    r = await client.post("/api/game/edu/action", json=_enter(ratio=0.3))
    assert r.status_code == 422
    # 실패한 요청은 참가로 치지 않는다
    assert (await client.post("/api/game/edu/action", json=_enter())).status_code == 200


async def test_leverage_5x_requires_academy(api, maker):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    r = await client.post("/api/game/edu/action", json=_enter(lev=5))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "LEVERAGE_LOCKED"
    async with maker() as db:
        db.add(UserAcademy(user_id=u.id, unlocked_leverage_5x=True, attempts=1))
        await db.commit()
    assert (await client.get("/api/game/edu/state")).json()["options"]["leverage_5x_unlocked"] is True
    r = await client.post("/api/game/edu/action", json=_enter(lev=5))
    assert r.status_code == 200 and r.json()["account"]["position"]["leverage"] == 5


async def test_anonymous_cannot_act_or_view_history(api):
    client, set_user = api
    set_user(None)
    assert (await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})).status_code == 401
    assert (await client.get("/api/game/edu/history")).status_code == 401
    r = await client.get("/api/game/edu/leaderboard")
    assert r.status_code == 200 and r.json()["my_rank"] is None


# ---------------------------------------------------------------- 정산(advance_day_and_settle)
async def test_auto_stop_loss_on_new_candle_low(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(sl=5, tp=10))
    sl = eng.round_tick(p * 0.95)
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.01), eng.round_tick(p * 0.93), eng.round_tick(p * 0.96))
    res = await _advance(maker)
    assert res["settled"] == 1 and res["closed"] == 1
    acc = await _account(maker, u.id)
    assert acc.pos_side is None and acc.total_trades == 1 and acc.win_trades == 0
    expected_pnl = svc.position_pnl("LONG", Decimal(p), Decimal(sl), Decimal("5000000"), 1)
    assert acc.cash_balance == Decimal("5000000") + Decimal("5000000") + expected_pnl
    assert acc.total_asset == acc.cash_balance and acc.current_roi < 0
    hist = (await client.get("/api/game/edu/history")).json()
    assert hist["actions"][0]["realized_pnl"] == float(expected_pnl)
    assert f"손절가 {sl:,}원 도달" in hist["actions"][0]["settlement_note"]


async def test_auto_take_profit_on_new_candle_high(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(ratio=1.0, lev=2, sl=3, tp=5))
    tp = eng.round_tick(p * 1.05)
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.08), eng.round_tick(p * 0.99), eng.round_tick(p * 1.06))
    await _advance(maker)
    acc = await _account(maker, u.id)
    pnl = svc.position_pnl("LONG", Decimal(p), Decimal(tp), Decimal("10000000"), 2)
    assert acc.pos_side is None and acc.win_trades == 1 and pnl > 0
    assert acc.cash_balance == Decimal("10000000") + pnl
    assert acc.max_roi == acc.current_roi > 0


async def test_short_position_profit_and_mark_to_market(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(side="SHORT", ratio=0.25, sl=7, tp=15))
    c = eng.round_tick(p * 0.97)  # 3% 하락 — 손절·익절 미도달 → 종가 평가
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.01), eng.round_tick(p * 0.96), c)
    res = await _advance(maker)
    assert res["closed"] == 0
    acc = await _account(maker, u.id)
    unreal = svc.position_pnl("SHORT", Decimal(p), Decimal(c), Decimal("2500000"), 1)
    assert acc.pos_side == "SHORT" and unreal > 0
    assert acc.total_asset == Decimal("7500000") + Decimal("2500000") + unreal
    state = (await client.get("/api/game/edu/state")).json()
    assert state["account"]["position"]["unrealized_pnl"] == float(unreal)


async def test_loss_capped_at_entry_amount(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    async with maker() as db:
        db.add(UserAcademy(user_id=u.id, unlocked_leverage_5x=True, attempts=1))
        await db.commit()
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(side="SHORT", ratio=0.5, lev=5, sl=7, tp=5))
    big = eng.round_tick(p * 1.5)  # 시가부터 +50% 갭 → 5배 SHORT 원래 손실 250%
    _patch_next(monkeypatch, big, eng.round_tick(p * 1.55), eng.round_tick(p * 1.45), big)
    await _advance(maker)
    acc = await _account(maker, u.id)
    assert acc.pos_side is None and acc.cash_balance == Decimal("5000000")  # 진입 500만만 잃고 끝(음수 없음)
    assert acc.total_asset == Decimal("5000000") and acc.current_roi == Decimal("-50.0000")
    hist = (await client.get("/api/game/edu/history")).json()["actions"][0]
    assert hist["realized_pnl"] == -5_000_000.0 and "강제 청산" in hist["settlement_note"]


async def test_partial_then_full_close(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(ratio=0.5, lev=2, sl=7, tp=15))
    c1 = eng.round_tick(p * 1.04)
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.05), eng.round_tick(p * 0.99), c1)
    await _advance(maker)

    r = await client.post("/api/game/edu/action", json={"action": "PARTIAL_CLOSE"})
    assert r.status_code == 200, r.text
    half_pnl = svc.position_pnl("LONG", Decimal(p), Decimal(c1), Decimal("2500000"), 2)
    body = r.json()
    assert body["action"]["realized_pnl"] == float(half_pnl) and body["action"]["side"] == "LONG"
    assert body["account"]["position"]["size_amount"] == 2_500_000.0
    acc = await _account(maker, u.id)
    assert acc.cash_balance == Decimal("5000000") + Decimal("2500000") + half_pnl
    assert acc.total_trades == 0

    c2 = eng.round_tick(c1 * 1.01)
    _patch_next(monkeypatch, c1, eng.round_tick(c1 * 1.02), eng.round_tick(c1 * 0.995), c2)
    await _advance(maker)
    r = await client.post("/api/game/edu/action", json={"action": "FULL_CLOSE"})
    assert r.status_code == 200
    rest_pnl = svc.position_pnl("LONG", Decimal(p), Decimal(c2), Decimal("2500000"), 2)
    acc = await _account(maker, u.id)
    assert acc.pos_side is None and acc.total_trades == 1 and acc.win_trades == 1
    assert acc.cash_balance == Decimal("10000000") + half_pnl + rest_pnl
    assert acc.participation_days == 3


async def test_keep_position_adjusts_levels(api, maker, monkeypatch):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(sl=7, tp=15))
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.02), eng.round_tick(p * 0.99), eng.round_tick(p * 1.01))
    await _advance(maker)
    r = await client.post("/api/game/edu/action", json={"action": "KEEP_POS", "stop_loss_pct": 3, "take_profit_pct": 5})
    assert r.status_code == 200, r.text
    pos = r.json()["account"]["position"]
    assert (pos["stop_loss_price"], pos["take_profit_price"]) == svc.stop_take_prices("LONG", p, 3, 5)


async def test_keep_position_rejects_levels_already_crossed(api, maker, monkeypatch):
    client, set_user = api
    set_user(await _user(maker))
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(sl=7, tp=15))
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.0), eng.round_tick(p * 0.95), eng.round_tick(p * 0.96))
    await _advance(maker)  # 종가 -4% → 손절 -3% 로 바꾸면 이미 넘은 가격
    r = await client.post("/api/game/edu/action", json={"action": "KEEP_POS", "stop_loss_pct": 3})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "INVALID_LEVELS"


async def test_auto_settlement_runs_once_per_kst_day(maker):
    monday = datetime(2026, 11, 23, 20, 0, tzinfo=KST)
    async with maker() as db:
        await svc.get_or_create_active_season(db, monday.date())
    first = await _advance(maker, force=False, now=monday)
    again = await _advance(maker, force=False, now=monday + timedelta(minutes=5))
    assert first["status"] == "advanced" and again == {"status": "skipped", "season_id": first["season_id"],
                                                       "day_index": 121}
    forced = await _advance(maker, force=True, now=monday + timedelta(minutes=6))  # 관리자는 제한 없음
    nxt = await _advance(maker, force=False, now=monday + timedelta(days=1))
    assert forced["day_index"] == 122 and nxt["day_index"] == 123
    season = await _season(maker)
    assert season.last_advanced_date == date(2026, 11, 24)


async def test_advance_without_season_is_noop(maker):
    async with maker() as db:
        assert await svc.advance_day_and_settle(db) == {"status": "no_season"}


# ---------------------------------------------------------------- 랭킹·내역
async def test_leaderboard_public_ranks_by_roi(api, maker, monkeypatch):
    client, set_user = api
    a = await _user(maker, nickname="상승러")
    b = await _user(maker, nickname="관망러")
    p = await _close(client)
    set_user(a)
    await client.post("/api/game/edu/action", json=_enter(ratio=1.0, sl=7, tp=15))
    set_user(b)
    await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    _patch_next(monkeypatch, p, eng.round_tick(p * 1.04), eng.round_tick(p * 0.99), eng.round_tick(p * 1.03))
    await _advance(maker)

    set_user(None)
    body = (await client.get("/api/game/edu/leaderboard")).json()
    assert [r["nickname"] for r in body["top"]] == ["상승러", "관망러"]
    assert body["top"][0]["rank"] == 1 and body["top"][0]["current_roi"] > 0
    set_user(b)
    assert (await client.get("/api/game/edu/leaderboard")).json()["my_rank"]["rank"] == 2


# ---------------------------------------------------------------- EDU_DAILY_GAME OFF
async def test_flag_off_state_minimal_and_others_403(api, maker):
    client, set_user = api
    async with maker() as db:
        db.add(GameFeatureFlag(key="EDU_DAILY_GAME", enabled=False))
        await db.commit()
    set_user(await _user(maker))
    r = await client.get("/api/game/edu/state")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is False and body["season"] is None and body["candles"] == []
    for method, url, kw in (
        ("post", "/api/game/edu/action", {"json": {"action": "HOLD_WATCH"}}),
        ("get", "/api/game/edu/history", {}),
        ("get", "/api/game/edu/leaderboard", {}),
    ):
        res = await getattr(client, method)(url, **kw)
        assert res.status_code == 403 and res.json() == {"detail": "edu_game_disabled"}, url
    async with maker() as db:  # OFF 면 시즌을 만들지 않는다
        assert (await db.execute(select(func.count()).select_from(EduGameSeason))).scalar() == 0


async def test_flag_default_on_and_independent_of_real_market(api, maker, monkeypatch):
    """REAL_MARKET(A안) 이 꺼져 있어도 교육 게임은 열린다."""
    from apps.trading_game.services import real_market

    async def _off(_db, _redis) -> bool:
        return False

    monkeypatch.setattr(real_market, "flag_on", _off)
    client, set_user = api
    set_user(None)
    assert (await client.get("/api/game/edu/state")).json()["enabled"] is True


def _switch_from_db(monkeypatch):
    """conftest 가 real_market.flag_on 을 항상 True 로 덮어쓰므로, 여기서는 실제 플래그 행(행 없음=OFF)을 읽게 되돌린다."""
    from apps.trading_game.services import feature_flag_service, real_market

    async def _db_flag(db, redis) -> bool:
        return await feature_flag_service.is_enabled(db, redis, "REAL_MARKET")

    monkeypatch.setattr(real_market, "flag_on", _db_flag)


async def test_state_real_market_switch_default_off(api, maker, monkeypatch):
    """REAL_MARKET 행 없음 = 전역 스위치 OFF → real_market_switch false(관리자여도 사용자별 판정과 무관)."""
    _switch_from_db(monkeypatch)
    client, set_user = api
    set_user(await _user(maker, role=UserRole.ADMIN, nickname="관리자"))
    body = (await client.get("/api/game/edu/state")).json()
    assert body["enabled"] is True and body["real_market_switch"] is False


async def test_state_real_market_switch_on(api, maker, monkeypatch):
    _switch_from_db(monkeypatch)
    client, set_user = api
    async with maker() as db:
        db.add(GameFeatureFlag(key="REAL_MARKET", enabled=True))
        await db.commit()
    set_user(None)
    body = (await client.get("/api/game/edu/state")).json()
    assert body["enabled"] is True and body["real_market_switch"] is True
    assert body["season"] is not None  # 기존 전체 응답은 그대로


async def test_state_real_market_switch_in_minimal_response(api, maker, monkeypatch):
    """EDU_DAILY_GAME OFF 최소 응답에도 스위치 값이 들어간다."""
    _switch_from_db(monkeypatch)
    client, set_user = api
    async with maker() as db:
        db.add(GameFeatureFlag(key="REAL_MARKET", enabled=True))
        db.add(GameFeatureFlag(key="EDU_DAILY_GAME", enabled=False))
        await db.commit()
    set_user(None)
    body = (await client.get("/api/game/edu/state")).json()
    assert body["enabled"] is False and body["real_market_switch"] is True and body["season"] is None


async def test_state_real_market_switch_admin_toggle(api, maker, monkeypatch):
    """관리자가 REAL_MARKET 을 켜고 끄면 state 의 스위치 값이 따라간다."""
    _switch_from_db(monkeypatch)
    client, set_user = api
    set_user(await _user(maker, role=UserRole.ADMIN, nickname="관리자"))
    assert (await client.put("/api/game/admin/feature-flags/REAL_MARKET", json={"enabled": True})).status_code == 200
    assert (await client.get("/api/game/edu/state")).json()["real_market_switch"] is True
    assert (await client.put("/api/game/admin/feature-flags/REAL_MARKET", json={"enabled": False})).status_code == 200
    assert (await client.get("/api/game/edu/state")).json()["real_market_switch"] is False


async def test_admin_flag_toggle_reflects_in_state(api, maker):
    client, set_user = api
    set_user(await _user(maker, role=UserRole.ADMIN, nickname="관리자"))
    r = await client.put("/api/game/admin/feature-flags/EDU_DAILY_GAME", json={"enabled": False})
    assert r.status_code == 200
    assert (await client.get("/api/game/edu/state")).json()["enabled"] is False


# ---------------------------------------------------------------- 관리자
async def test_admin_endpoints_require_admin(api, maker):
    client, set_user = api
    set_user(await _user(maker))
    assert (await client.post("/api/game/admin/edu/advance-day")).status_code == 403
    assert (await client.post("/api/game/admin/edu/new-season", json={})).status_code == 403
    assert (await client.put("/api/game/admin/edu/regime", json={"regime": "UPTREND"})).status_code == 403
    assert (await client.get("/api/game/admin/edu/season")).status_code == 403


async def test_admin_advance_regime_and_new_season(api, maker):
    client, set_user = api
    set_user(await _user(maker, role=UserRole.ADMIN, nickname="관리자"))
    assert (await client.get("/api/game/admin/edu/season")).json() is None

    r = await client.post("/api/game/admin/edu/advance-day")  # 시즌이 없으면 먼저 만든 뒤 1봉
    assert r.status_code == 200 and r.json()["status"] == "advanced" and r.json()["day_index"] == 121
    r = await client.post("/api/game/admin/edu/advance-day")  # 같은 날 다시 — 관리자는 제한 없음
    assert r.json()["day_index"] == 122

    r = await client.put("/api/game/admin/edu/regime", json={"regime": "DOWNTREND"})
    assert r.status_code == 200 and r.json()["next_regime_override"] == "DOWNTREND"
    assert (await client.post("/api/game/admin/edu/advance-day")).json()["regime"] == "DOWNTREND"
    info = (await client.get("/api/game/admin/edu/season")).json()
    assert info["current_regime"] == "DOWNTREND" and info["next_regime_override"] is None
    assert (await client.put("/api/game/admin/edu/regime", json={"regime": "NOPE"})).status_code == 422

    r = await client.post("/api/game/admin/edu/new-season",
                          json={"title": "[교육 차트 #2] 친환경·에너지 추세 가상지수", "theme_category": "친환경",
                                "hide_name": True})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["season_number"] == 2 and new["current_day_index"] == 120 and new["hide_name"] is True
    async with maker() as db:
        rows = (await db.execute(select(EduGameSeason).order_by(EduGameSeason.id))).scalars().all()
        assert [(s.season_number, s.status) for s in rows] == [(1, "CLOSED"), (2, "ACTIVE")]
        assert rows[0].end_date is not None
    state = (await client.get("/api/game/edu/state")).json()
    assert state["season"]["season_number"] == 2 and state["account"] is None


# ---------------------------------------------------------------- Celery
def test_celery_beat_registered_weekdays_20_kst_and_kept_in_readonly():
    from apps.collector import celery_app as ca

    entry = ca.celery_app.conf.beat_schedule["edu-game-advance-day"]
    assert entry["task"] == "edu_game_advance_day"
    sched = entry["schedule"]
    assert sched.hour == {20} and sched.minute == {0} and sched.day_of_week == {1, 2, 3, 4, 5}
    assert ca.celery_app.conf.timezone == "Asia/Seoul"
    assert "apps.collector.tasks.edu_game" in ca.celery_app.conf.include
    assert "edu-game-advance-day" in ca.readonly_beat_schedule(dict(ca.celery_app.conf.beat_schedule))


async def test_celery_run_once_respects_flag_and_daily_guard(maker, monkeypatch):
    from apps.collector.tasks import edu_game as task

    redis = fake_aioredis.FakeRedis(decode_responses=True)
    async with maker() as db:
        await svc.get_or_create_active_season(db)
    async with maker() as db:
        assert (await task.run_once(db, redis))["status"] == "advanced"
    async with maker() as db:
        assert (await task.run_once(db, redis))["status"] == "skipped"
    async with maker() as db:
        db.add(GameFeatureFlag(key="EDU_DAILY_GAME", enabled=False))
        await db.commit()
    await redis.flushall()
    async with maker() as db:
        assert await task.run_once(db, redis) == {"status": "disabled"}


async def test_js_integer_ratio_one_is_accepted(api, maker):
    """JS 는 1.0 을 정수 1 로 직렬화한다 — 원문 JSON {"ratio":1} 도 100% 비중으로 받아야 한다."""
    client, set_user = api
    set_user(await _user(maker))
    raw = '{"action":"ENTER_LONG","ratio":1,"leverage":1,"stop_loss_pct":5,"take_profit_pct":10}'
    r = await client.post("/api/game/edu/action", content=raw, headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text
    assert r.json()["account"]["position"]["size_amount"] == 10_000_000.0 and r.json()["action"]["ratio"] == 1.0


async def test_roi_clamped_to_column_limit(maker):
    async with maker() as db:
        season = await svc.get_or_create_active_season(db, date(2026, 11, 23))
    acc = EduGameAccount(cash_balance=Decimal("5000000000"), bonus_cash=Decimal(0), max_roi=Decimal(0))
    svc.refresh_totals(acc, season, None)
    assert acc.current_roi == svc.ROI_LIMIT == acc.max_roi


# ---------------------------------------------------------------- 독립 검토 반영(2차)
async def test_account_create_conflict_keeps_same_session_user_usable(maker, monkeypatch):
    """계좌 동시 생성 충돌(세이브포인트) 뒤에도 같은 세션에서 읽은 user 를 그대로 쓴다 — 500 아님."""
    u = await _user(maker)
    async with maker() as db:
        season = await svc.get_or_create_active_season(db)
        db.add(EduGameAccount(user_id=u.id, season_id=season.id))  # 다른 요청이 먼저 만든 계좌
        await db.commit()
    real = svc._account
    calls = {"n": 0}

    async def racing(db, user_id, season_id, *, lock=False):
        calls["n"] += 1
        return None if calls["n"] == 1 else await real(db, user_id, season_id, lock=lock)

    monkeypatch.setattr(svc, "_account", racing)
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    async with maker() as db:
        user = await db.get(User, u.id)  # 요청 인증과 같은 세션에서 읽은 객체
        out = await svc.submit_daily_action(db, redis, user, {"action": "HOLD_WATCH"})
    assert out["action"]["action_type"] == "HOLD_WATCH"


async def test_bootstrap_conflict_keeps_same_session_user_usable(maker, monkeypatch):
    u = await _user(maker, nickname="같은세션")
    async with maker() as db:
        await svc.get_or_create_active_season(db)
    real = svc._active_season

    def racing_factory():
        calls = {"n": 0}

        async def racing(db, *, lock=None):
            calls["n"] += 1
            return None if calls["n"] == 1 else await real(db, lock=lock)
        return racing

    redis = fake_aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(svc, "_active_season", racing_factory())
    async with maker() as db:
        user = await db.get(User, u.id)
        state = await svc.get_edu_state(db, user)
        assert state["logged_in"] is True and state["season"]["season_number"] == 1
    monkeypatch.setattr(svc, "_active_season", racing_factory())
    async with maker() as db:
        user = await db.get(User, u.id)
        out = await svc.submit_daily_action(db, redis, user, {"action": "HOLD_WATCH"})
        assert out["action"]["day_index"] == 120
    monkeypatch.setattr(svc, "_active_season", racing_factory())
    async with maker() as db:
        user = await db.get(User, u.id)
        board = await svc.get_leaderboard(db, user)
        assert board["my_rank"]["nickname"] == "같은세션"
    monkeypatch.setattr(svc, "_active_season", racing_factory())
    async with maker() as db:
        user = await db.get(User, u.id)
        assert len((await svc.get_history(db, user))["actions"]) == 1
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(EduGameSeason))).scalar() == 1


@pytest.mark.parametrize("cash, roi", [(Decimal("5000000"), Decimal("-50.0000")), (Decimal("20000000"), Decimal("100.0000"))])
async def test_hold_watch_bonus_keeps_roi(api, maker, cash, roi):
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    await client.get("/api/game/edu/state")
    season = await _season(maker)
    async with maker() as db:
        db.add(EduGameAccount(user_id=u.id, season_id=season.id, cash_balance=cash, total_asset=cash,
                              current_roi=roi, max_roi=max(roi, Decimal(0))))
        await db.commit()
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH"})
    assert r.status_code == 200 and r.json()["bonus_cash_awarded"] == 10000.0
    acc = await _account(maker, u.id)
    assert acc.cash_balance == cash + Decimal("10000")
    assert acc.current_roi == roi  # 보너스가 ROI 를 0 쪽으로 끌어당기지 않는다
    assert acc.bonus_cash == (Decimal("10000") / (1 + roi / 100)).quantize(Decimal("0.01"))


async def test_stale_day_index_is_409_and_matching_day_ok(api, maker):
    client, set_user = api
    set_user(await _user(maker))
    day = (await client.get("/api/game/edu/state")).json()["season"]["current_day_index"]
    await _advance(maker)  # 사용자가 화면을 보는 사이 새 봉이 열림
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH", "day_index": day})
    assert r.status_code == 409 and r.json() == {"detail": {"code": "STALE_DAY", "message": svc.MSG_STALE_DAY}}
    r = await client.post("/api/game/edu/action", json={"action": "HOLD_WATCH", "day_index": day + 1})
    assert r.status_code == 200 and r.json()["action"]["day_index"] == day + 1


async def test_settlement_notes_accumulate_newest_first(api, maker, monkeypatch):
    """보유만 하고 며칠 참가하지 않아도 정산 기록이 덮어써지지 않는다(최근 것이 앞, 200자 제한)."""
    client, set_user = api
    u = await _user(maker)
    set_user(u)
    p = await _close(client)
    await client.post("/api/game/edu/action", json=_enter(sl=7, tp=15))
    for _ in range(2):
        _patch_next(monkeypatch, p, eng.round_tick(p * 1.01), eng.round_tick(p * 0.99), p)
        await _advance(maker)
    note = (await client.get("/api/game/edu/history")).json()["actions"][0]["settlement_note"]
    assert note.startswith("Day 122:") and "Day 121:" in note and len(note) <= 200
    for _ in range(10):
        _patch_next(monkeypatch, p, eng.round_tick(p * 1.01), eng.round_tick(p * 0.99), p)
        await _advance(maker)
    note = (await client.get("/api/game/edu/history")).json()["actions"][0]["settlement_note"]
    assert note.startswith("Day 132:") and len(note) <= 200


async def test_total_asset_clamped_to_column_limit(maker):
    async with maker() as db:
        season = await svc.get_or_create_active_season(db, date(2026, 11, 23))
    acc = EduGameAccount(cash_balance=Decimal("99999999999999"), bonus_cash=Decimal(0), max_roi=Decimal(0))
    svc.refresh_totals(acc, season, None)
    assert acc.total_asset == svc.ASSET_LIMIT


async def test_advance_commit_conflict_returns_skipped_with_season_id(maker, monkeypatch):
    """다른 정산이 같은 봉을 먼저 만든 경우(uq_edu_season_day) — rollback 뒤에도 season_id 를 안전하게 돌려준다."""
    async with maker() as db:
        sid = (await svc.get_or_create_active_season(db, date(2026, 11, 23))).id
    real = eng.generate_next_candle

    def dup(seed, season_id, history, regime, days_left, override=None):
        bar, r, d = real(seed, season_id, history, regime, days_left, override)
        bar["day_index"] = history[-1]["day_index"]  # 이미 있는 봉 번호 → commit 시 유일 제약 충돌
        return bar, r, d

    monkeypatch.setattr(eng, "generate_next_candle", dup)
    assert await _advance(maker) == {"status": "skipped", "season_id": sid, "day_index": 119}


# ---------------------------------------------------------------- GET /api/game/edu/features(탭 노출 판단 전용)
from apps.trading_game.services import real_market as _real_market_mod  # noqa: E402

_REAL_FLAG_ON = _real_market_mod.flag_on  # conftest 가 덮어쓰기 전 원본(조회 실패 → false 처리 포함)


@pytest.fixture
async def raw_api(maker, fake_redis):
    """인증 의존성을 덮어쓰지 않은 클라이언트 — 실제 토큰 처리(잘못된 토큰)를 그대로 탄다."""

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


async def _row_counts(maker) -> tuple[int, ...]:
    counts = []
    async with maker() as db:
        for m in (EduGameSeason, EduGameCandle, EduGameAccount, GameFeatureFlag):
            counts.append((await db.execute(select(func.count()).select_from(m))).scalar())
    return tuple(counts)


async def test_features_does_not_create_season(raw_api, maker, monkeypatch):
    """시즌 0개에서 불러도 시즌·봉·계좌가 생기지 않는다(state 와 다름)."""
    _switch_from_db(monkeypatch)
    before = await _row_counts(maker)
    assert before[0] == 0
    for _ in range(2):
        r = await raw_api.get("/api/game/edu/features")
        assert r.status_code == 200
        assert r.json() == {"enabled": True, "real_market_switch": False}
        assert r.headers["cache-control"] == "public, max-age=30"
    assert await _row_counts(maker) == before


@pytest.mark.parametrize("edu,switch", [(True, True), (True, False), (False, True), (False, False)])
async def test_features_flag_combinations(raw_api, maker, monkeypatch, edu, switch):
    _switch_from_db(monkeypatch)
    async with maker() as db:
        db.add(GameFeatureFlag(key="EDU_DAILY_GAME", enabled=edu))
        db.add(GameFeatureFlag(key="REAL_MARKET", enabled=switch))
        await db.commit()
    body = (await raw_api.get("/api/game/edu/features")).json()
    assert body == {"enabled": edu, "real_market_switch": switch}
    async with maker() as db:
        assert (await db.execute(select(func.count()).select_from(EduGameSeason))).scalar() == 0


async def test_features_ignores_invalid_token(raw_api, maker, monkeypatch):
    """공개 값이라 토큰을 보지 않는다 — 잘못된 토큰도 401 이 아니라 200(같은 토큰으로 state 는 401)."""
    _switch_from_db(monkeypatch)
    headers = {"Authorization": "Bearer not-a-valid-token"}
    r = await raw_api.get("/api/game/edu/features", headers=headers)
    assert r.status_code == 200 and r.json() == {"enabled": True, "real_market_switch": False}
    assert (await raw_api.get("/api/game/edu/state", headers=headers)).status_code == 401


async def test_features_flag_lookup_failure_is_closed(raw_api, maker, monkeypatch):
    """플래그 조회 오류는 500 대신 둘 다 false(닫힘)."""
    from apps.trading_game.services import feature_flag_service

    async def _boom(_db, _redis, _flag) -> bool:
        raise RuntimeError("db down")

    monkeypatch.setattr(_real_market_mod, "flag_on", _REAL_FLAG_ON)
    monkeypatch.setattr(feature_flag_service, "is_enabled", _boom)
    r = await raw_api.get("/api/game/edu/features")
    assert r.status_code == 200 and r.json() == {"enabled": False, "real_market_switch": False}

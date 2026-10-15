"""데일리 코치 지지·저항 추천 — 순수 계산(sr_levels) + admin 추천 API."""
from __future__ import annotations

import random
from datetime import date, datetime, timezone

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.game_models import GameSeason
from shared.models import Base, User, UserRole
from apps.trading_game.main import app
from apps.trading_game.services import coach_levels_service
from apps.trading_game.services.sr_levels import Bar, krx_tick, round_to_tick, suggest_levels


def _flat(n: int, price: float, spread: float = 0.002) -> list[Bar]:
    return [Bar(high=price * (1 + spread), low=price * (1 - spread), close=price) for _ in range(n)]


def _swing(bars: list[Bar], i: int, *, high: float | None = None, low: float | None = None) -> None:
    b = bars[i]
    bars[i] = Bar(high=high if high is not None else b.high, low=low if low is not None else b.low, close=b.close)


# ---------------------------------------------------------------- 호가단위
@pytest.mark.parametrize("price, tick", [
    (1_999, 1), (2_000, 5), (4_999, 5), (5_000, 10), (19_999, 10), (20_000, 50),
    (49_999, 50), (50_000, 100), (199_999, 100), (200_000, 500), (499_999, 500), (500_000, 1_000),
])
def test_krx_tick_boundaries(price, tick):
    assert krx_tick(price) == tick


def test_round_to_tick_nearest():
    assert round_to_tick(231_740) == 231_500
    assert round_to_tick(231_760) == 232_000
    assert round_to_tick(48_020) == 48_000
    assert round_to_tick(48_030) == 48_050


# ---------------------------------------------------------------- 지지·저항
def test_insufficient_bars_returns_none():
    s, r = suggest_levels(_flat(9, 100_000))
    assert s is None and r is None


def test_picks_most_touched_zone_below_and_above():
    bars = _flat(60, 100_000)
    for i in (10, 25, 40):  # 95,000 근처 저점 3회(가장 많이 닿음)
        _swing(bars, i, low=95_000)
    _swing(bars, 50, low=98_000)  # 가까운 저점 1회
    for i in (15, 30):  # 105,000 근처 고점 2회
        _swing(bars, i, high=105_000)
    s, r = suggest_levels(bars)
    assert s is not None and r is not None
    assert s.price == 95_000 and s.touches == 3
    assert "저점권" in s.basis and "3회" in s.basis
    assert r.price == 105_000 and r.touches == 2


def test_near_zone_beats_far_dense_zone():
    # 삼성 2026-10 급락 재현: 멀리(+13%) 오래 머문 매물대보다 가까운(+4.5%) 깨진 지지가 저항
    bars = _flat(30, 266_000, spread=0.01)
    for i in (5, 12, 19):
        _swing(bars, i, low=262_000)
    bars += _flat(20, 250_000, spread=0.01)
    for i in (33, 39, 45):
        _swing(bars, i, low=245_000)
    bars += _flat(10, 234_500, spread=0.01)
    _, r = suggest_levels(bars)
    assert r is not None and 244_000 <= r.price <= 246_000
    assert "깨진 지지" in r.basis


def test_role_reversal_old_high_becomes_support():
    bars = _flat(40, 100_000)
    for i in (5, 12, 19):  # 예전 고점 101,000
        _swing(bars, i, high=101_000)
    bars += _flat(20, 104_000)  # 돌파 후 104,000 에서 횡보
    _swing(bars, 45, low=101_000)  # 되돌림이 예전 고점에서 멈춤
    s, _ = suggest_levels(bars)
    assert s is not None and s.price == 101_000
    assert "매물대" in s.basis  # 예전 고점 + 되돌림 저점이 한 가격대


def test_new_high_breakout_has_no_resistance():
    bars = [Bar(high=p * 1.005, low=p * 0.995, close=p) for p in range(90_000, 120_000, 500)]  # 60봉 꾸준한 상승
    s, r = suggest_levels(bars)
    assert r is None
    assert s is not None and s.price < bars[-1].close


def test_levels_beyond_15pct_are_ignored():
    bars = _flat(60, 100_000)
    _swing(bars, 5, low=70_000)  # 30% 아래 — 제외
    _swing(bars, 8, high=130_000)  # 30% 위 — 제외
    s, r = suggest_levels(bars)
    if s is not None:
        assert 85_000 <= s.price < 100_000
    if r is not None:
        assert 100_000 < r.price <= 115_000


def test_downtrend_without_confirmed_low_has_no_support():
    # 꾸준한 하락 — 최저가가 마지막 봉(미확정)이라 지지를 지어내지 않는다
    bars = [Bar(high=p * 1.002, low=p * 0.998, close=p) for p in range(130_000, 100_000, -500)]
    s, r = suggest_levels(bars)
    assert s is None
    assert r is not None and r.price > bars[-1].close


def test_support_falls_back_to_confirmed_20d_low():
    # 스윙 저점은 없지만(박스 하단이 평평) 20일 최저가는 확정됨 → 폴백
    bars = _flat(60, 100_000)
    s, r = suggest_levels(bars)
    assert s is not None and s.price == 99_800 and "20거래일 최저가" in s.basis
    assert r is not None and r.price == 100_200 and "20거래일 최고가" in r.basis


def test_levels_stay_strictly_around_close_after_rounding():
    bars = _flat(60, 232_000, spread=0.0005)  # 가격대가 기준가에 붙어 있어 반올림하면 같아지는 경우
    s, r = suggest_levels(bars)
    last = bars[-1].close
    if s is not None:
        assert s.price < last and s.price % krx_tick(s.price) == 0
    if r is not None:
        assert r.price > last and r.price % krx_tick(r.price) == 0


@pytest.mark.parametrize("seed", range(20))
def test_invariants_on_random_walks(seed):
    rnd = random.Random(seed)
    p = 50_000.0
    bars = []
    for _ in range(80):
        o = p
        p = max(1_000.0, p * (1 + rnd.uniform(-0.03, 0.03)))
        bars.append(Bar(high=max(o, p) * (1 + rnd.uniform(0, 0.01)),
                        low=min(o, p) * (1 - rnd.uniform(0, 0.01)), close=p))
    s, r = suggest_levels(bars)
    last = bars[-1].close
    if s is not None:
        assert 0 < s.price < last and s.price >= last * 0.85 - krx_tick(last)
    if r is not None:
        assert r.price > last and r.price <= last * 1.15 + krx_tick(last)


# ---------------------------------------------------------------- admin 추천 API
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
async def api(maker):
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


async def _seed(maker, role: UserRole = UserRole.ADMIN) -> tuple[int, User]:
    async with maker() as db:
        season = GameSeason(
            season_number=1, ticker="005930", stock_name="삼성전자",
            start_at=datetime(2026, 10, 1, tzinfo=timezone.utc), status="ACTIVE",
        )
        user = User(nickname="관리자", role=role, is_active=True)
        db.add_all([season, user])
        await db.commit()
        await db.refresh(season)
        await db.refresh(user)
        return season.id, user


def _fake_fetch(calls: list):
    def fetch(ticker: str, start: date, end: date) -> list[Bar]:
        calls.append((ticker, start, end))
        bars = _flat(60, 232_000)
        for i in (10, 30):
            _swing(bars, i, low=228_000)
        _swing(bars, 20, high=240_000)
        return bars
    return fetch


URL = "/api/game/admin/coach-levels/suggest"


def _params(season_id: int, coach_type: str = "MORNING") -> dict:
    return {"season_id": season_id, "target_date": "2026-10-15", "coach_type": coach_type}


async def test_suggest_morning_uses_bars_before_target_date(api, maker, monkeypatch):
    client, set_user = api
    season_id, admin = await _seed(maker)
    set_user(admin)
    calls: list = []
    monkeypatch.setattr(coach_levels_service, "fetch_bars", _fake_fetch(calls))

    r = await client.get(URL, params=_params(season_id))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticker"] == "005930"
    assert body["last_close"] == 232_000
    assert body["support"]["price"] == 228_000 and body["support"]["touches"] == 2
    assert body["resistance"]["price"] == 240_000
    assert calls[0][0] == "005930" and calls[0][2] == date(2026, 10, 14)


async def test_suggest_evening_includes_target_date(api, maker, monkeypatch):
    client, set_user = api
    season_id, admin = await _seed(maker)
    set_user(admin)
    calls: list = []
    monkeypatch.setattr(coach_levels_service, "fetch_bars", _fake_fetch(calls))
    r = await client.get(URL, params=_params(season_id, "EVENING"))
    assert r.status_code == 200
    assert calls[0][2] == date(2026, 10, 15)


async def test_suggest_unknown_season_404(api, maker, monkeypatch):
    client, set_user = api
    _, admin = await _seed(maker)
    set_user(admin)
    monkeypatch.setattr(coach_levels_service, "fetch_bars", _fake_fetch([]))
    r = await client.get(URL, params=_params(999))
    assert r.status_code == 404


@pytest.mark.parametrize("result", [[], None, RuntimeError("ch down")])
async def test_suggest_no_data_503(api, maker, monkeypatch, result):
    client, set_user = api
    season_id, admin = await _seed(maker)
    set_user(admin)

    def fetch(*_a):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(coach_levels_service, "fetch_bars", fetch)
    r = await client.get(URL, params=_params(season_id))
    assert r.status_code == 503


async def test_suggest_requires_admin(api, maker, monkeypatch):
    client, set_user = api
    season_id, user = await _seed(maker, role=UserRole.FREE)
    set_user(user)
    monkeypatch.setattr(coach_levels_service, "fetch_bars", _fake_fetch([]))
    r = await client.get(URL, params=_params(season_id))
    assert r.status_code == 403

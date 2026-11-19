"""A안 시세 비노출 — stock_api 시세 열람 판정(market_access)과 GraphQL·REST 차단.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-1~2-4·7절
- 스위치 OFF + 토큰 없음 → GraphQL 빈 값 / REST 403 market_data_disabled
- 스위치 OFF + 관리자 토큰 → 정상, 일반 회원 토큰 → 차단, 열람 권한 회원 → 정상, 잘못된 토큰 → 401 아닌 차단
- 스위치 ON → 정상(토큰을 보지 않음 — 잘못된 토큰도 지금처럼 통과)
- marketOverview OFF: FRED 거시만, 지수(KIS·장중 값)는 비어 있고 읽지도 않음
- 스위치 행 없음·DB 오류 → OFF
- 판정은 요청마다 한 번

실제 외부 호출 0회: 회원은 sqlite 메모리, 시세 서비스는 monkeypatch.
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.ai_analyst import router as ai_router
from apps.ai_analyst.schemas import InvestorFlowResponse
from apps.ai_analyst.services import investor_flow_ai, market_movers
from apps.stock_api.graphql import schema as gql_schema
from apps.stock_api.main import app
from apps.stock_api.seed_catalog import SeedStock
from apps.stock_api.services import (
    canslim_query,
    featured_query,
    lending_query,
    market_access,
    market_query,
    screener_features,
)
from apps.stock_api.services import chart as chart_service
from apps.stock_api.services.chart import Candle
from apps.stock_api.services import clickhouse_source as ch_source
from shared.models import Base, User, UserRole
from shared.security import create_access_token

# conftest 가 테스트마다 ON 으로 덮어쓰기 전의 진짜 판정 함수(행 없음·DB 오류 → OFF 검증용)
REAL_SWITCH = market_access.market_data_switch_on

GROUPS = {"date": "2026-11-18", "total": 1, "items": [
    {"id": "T1", "name": "반도체", "members": 10, "chg": 1.5, "value": 1e12, "up": 7, "down": 2, "flat": 1,
     "leader": None, "rank": 1, "streak": 2}]}
MACRO = [{"series_id": "DGS10", "name": "미 국채 10년", "unit": "%", "date": "2026-11-17", "value": 4.1, "prev": 4.0}]
INDICES = [{"code": "KR:KOSPI", "name": "코스피", "region": "KR", "date": "2026-11-18", "close": 2600.0,
            "chg1d": 0.5, "spark": [2590.0, 2600.0]}]
CALENDAR = [
    {"date": "2026-11-20", "title": "가나 공모주 청약", "category": "공모주", "ticker": "123450", "name": "가나",
     "detail": "x"},
    {"date": "2026-11-21", "title": "미국 CPI", "category": "경제지표", "ticker": None, "name": None,
     "detail": "발표 예정"},
]
CANDLES = [Candle(date="2026-11-18", open=1.0, high=2.0, low=0.5, close=1.5, volume=10)]

GQL = """{
  screenerFeatures { stockFinder finder patterns marketData }
  marketGroups { date total items { id } }
  canslimScreen { date total items { ticker } }
  canslimMarket { market }
  marketOverview { indices { code } macro { seriesId } }
  marketCalendar(start: "2026-11-19", end: "2026-11-30") { category }
  getChartData(symbol: "005930", startDate: "2026-11-01", endDate: "2026-11-18") { symbol candles { date } }
}"""

REST_PATHS = [
    "/api/v1/market/movers",
    "/api/v1/market/investor-flow",
    "/api/v1/market/heatmap",
    "/api/v1/market/featured",
    "/api/v1/ai/screener-analysis/005930",
    "/api/v1/stocks/005930/lending",
]


def _boom(*_a, **_k):
    raise AssertionError("차단 상태에서 시세 원천을 읽으면 안 된다")


@pytest.fixture
def switch(monkeypatch):
    state = {"on": False}
    monkeypatch.setattr(market_access, "market_data_switch_on", lambda: state["on"])
    return state


@pytest.fixture
def calls(monkeypatch):
    """시세 서비스는 고정 데이터로 — 호출 횟수도 센다."""
    seen: dict[str, int] = {}

    def track(name, value):
        def fn(*_a, **_k):
            seen[name] = seen.get(name, 0) + 1
            return value() if callable(value) else value
        return fn

    monkeypatch.setattr(market_query, "groups", track("groups", lambda: dict(GROUPS)))
    monkeypatch.setattr(market_query, "macro", track("macro", lambda: list(MACRO)))
    monkeypatch.setattr(market_query, "overview", track("overview", lambda: {"indices": INDICES, "macro": MACRO}))
    monkeypatch.setattr(market_query, "calendar", track("calendar", lambda: [dict(e) for e in CALENDAR]))
    monkeypatch.setattr(market_query, "treemap", track("treemap", {"date": "2026-11-18", "groups": []}))
    monkeypatch.setattr(canslim_query, "screen", track("canslim", {"date": "2026-11-18", "total": 0, "items": []}))
    monkeypatch.setattr(canslim_query, "markets", track("canslim_market", [
        {"market": "KOSPI", "date": "2026-11-18", "status": "상승 추세", "close": 1.0, "ma50": 1.0, "ma200": 1.0,
         "distribution_days": 0}]))
    monkeypatch.setattr(chart_service, "resolve_stock", lambda s: SeedStock(
        symbol=s, name="삼성전자", market="KOSPI", country="KR", currency="KRW"))
    monkeypatch.setattr(ch_source, "get_candles", track("candles", lambda: list(CANDLES)))
    monkeypatch.setattr(market_movers, "get_cached", track("movers", {"updated_at": "x", "gainers": [], "losers": [],
                                                                     "keywords": []}))
    monkeypatch.setattr(investor_flow_ai, "get_cached", track("flow", lambda: InvestorFlowResponse().model_dump()))
    monkeypatch.setattr(featured_query, "get_featured", track("featured", featured_query.empty()))
    monkeypatch.setattr(ai_router, "_screener_analysis", track("analysis", None))
    monkeypatch.setattr(ai_router, "_morning_brief", track("brief", None))
    monkeypatch.setattr(lending_query, "lending_trend", track("lending", [
        {"date": "2026-11-18", "balance_qty": 1, "net_qty": 0, "balance_amt": 1.0}]))
    return seen


@pytest.fixture
async def users(monkeypatch):
    """sqlite 메모리 회원 DB — market_access.load_viewer 가 실제 JWT 검증(get_current_user)을 탄다."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(market_access.database, "AsyncSessionLocal", maker)
    out = {}
    async with maker() as db:
        for key, role, access in (("admin", UserRole.ADMIN, False), ("free", UserRole.FREE, False),
                                  ("granted", UserRole.FREE, True)):
            u = User(email=f"{key}@test.local", nickname=key, role=role, is_active=True, market_data_access=access)
            db.add(u)
            await db.commit()
            await db.refresh(u)
            out[key] = {"Authorization": f"Bearer {create_access_token(subject=u.id, role=u.role.value)}"}
    yield out
    await engine.dispose()


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _gql(client, headers=None) -> dict:
    r = await client.post("/graphql", json={"query": GQL}, headers=headers or {})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("errors") is None, body
    return body["data"]


def _assert_blocked(data: dict) -> None:
    assert data["screenerFeatures"]["marketData"] is False
    assert data["marketGroups"] == {"date": None, "total": 0, "items": []}
    assert data["canslimScreen"] == {"date": None, "total": 0, "items": []}
    assert data["canslimMarket"] == []
    assert data["marketOverview"] == {"indices": [], "macro": [{"seriesId": "DGS10"}]}  # FRED 거시는 유지
    assert data["marketCalendar"] == [{"category": "경제지표"}]  # 공모주(KIS) 제외
    assert data["getChartData"] == {"symbol": "005930", "candles": []}  # 오류 아닌 빈 캔들


def _assert_open(data: dict) -> None:
    assert data["screenerFeatures"]["marketData"] is True
    assert data["marketGroups"]["total"] == 1 and data["marketGroups"]["items"] == [{"id": "T1"}]
    assert data["canslimMarket"] == [{"market": "KOSPI"}]
    assert data["marketOverview"]["indices"] == [{"code": "KR:KOSPI"}]
    assert [e["category"] for e in data["marketCalendar"]] == ["공모주", "경제지표"]


async def _rest_statuses(client, headers=None) -> dict[str, httpx.Response]:
    return {p: await client.get(p, headers=headers or {}) for p in REST_PATHS}


# ---------------------------------------------------------------- 스위치 OFF
async def test_off_anonymous_blocked(client, switch, calls):
    _assert_blocked(await _gql(client))
    # 차단 상태에서는 시세 원천(지수·순위·CANSLIM·캔들)을 아예 읽지 않는다
    for name in ("groups", "overview", "canslim", "canslim_market", "candles"):
        assert name not in calls, name
    for path, r in (await _rest_statuses(client)).items():
        assert r.status_code == 403, path
        assert r.json() == {"detail": "market_data_disabled"}, path
    assert not {"movers", "flow", "featured", "analysis", "lending", "treemap"} & set(calls)


async def test_off_morning_brief_stays_open(client, switch, calls):
    # 모닝 브리핑은 텍스트 전용이라 막지 않는다(설계 3-2)
    r = await client.get("/api/v1/market/morning-brief")
    assert r.status_code == 200 and r.json() == {"brief": None}


async def test_off_admin_token_open(client, switch, calls, users):
    _assert_open(await _gql(client, users["admin"]))
    for path, r in (await _rest_statuses(client, users["admin"])).items():
        assert r.status_code == 200, (path, r.text)
        # 토큰 덕분에 열린 응답은 공유 캐시가 익명에게 되돌려주지 않게 private
        assert r.headers["cache-control"].startswith("private"), path


async def test_off_free_user_blocked(client, switch, calls, users):
    _assert_blocked(await _gql(client, users["free"]))
    for path, r in (await _rest_statuses(client, users["free"])).items():
        assert r.status_code == 403, path


async def test_off_granted_user_open(client, switch, calls, users):
    _assert_open(await _gql(client, users["granted"]))
    for path, r in (await _rest_statuses(client, users["granted"])).items():
        assert r.status_code == 200, (path, r.text)


async def test_off_invalid_token_is_anonymous_not_401(client, switch, calls, users):
    bad = {"Authorization": "Bearer not-a-jwt"}
    _assert_blocked(await _gql(client, bad))
    for path, r in (await _rest_statuses(client, bad)).items():
        assert r.status_code == 403, path  # 401 이면 앱이 리프레시·로그아웃 흐름을 탄다


async def test_off_other_resolvers_empty_not_error(client, switch, calls, monkeypatch):
    """나머지 시세 리졸버도 OFF 면 오류 없이 빈 값 — 설치된 옛 앱이 죽지 않게(설계 2-3)."""
    from apps.stock_api.services import pattern_query, screener_query

    for mod, name in ((canslim_query, "score"), (screener_query, "screen"), (pattern_query, "screen"),
                      (pattern_query, "bases"), (market_query, "group")):
        monkeypatch.setattr(mod, name, _boom)
    monkeypatch.setattr(market_query, "treemap", _boom)
    q = """{
      canslimScore(ticker: "005930") { ticker }
      screenerScreen(preset: "volume_surge", filters: {market: "ALL", bbSigma: 2.5}) { date total bbSigma items { ticker } }
      patternScreen { date total items { ticker } }
      patternBases(ticker: "005930") { date ticker name close bases { label } zones { buyLow } }
      marketTreemap { date groups { id } }
      marketGroup(kind: "theme", id: "T1") { id }
    }"""
    r = await client.post("/graphql", json={"query": q})
    body = r.json()
    assert r.status_code == 200 and body.get("errors") is None, body
    assert body["data"] == {
        "canslimScore": None,
        "screenerScreen": {"date": None, "total": 0, "bbSigma": 2.5, "items": []},
        "patternScreen": {"date": None, "total": 0, "items": []},
        "patternBases": {"date": None, "ticker": "005930", "name": "005930", "close": None, "bases": [], "zones": None},
        "marketTreemap": {"date": None, "groups": []},
        "marketGroup": None,
    }


# ---------------------------------------------------------------- 스위치 ON
async def test_on_open_for_everyone_and_token_ignored(client, switch, calls, monkeypatch):
    switch["on"] = True
    monkeypatch.setattr(market_access, "load_viewer", _boom)  # ON 이면 토큰·DB 를 보지 않는다
    _assert_open(await _gql(client))
    _assert_open(await _gql(client, {"Authorization": "Bearer not-a-jwt"}))
    for path, r in (await _rest_statuses(client, {"Authorization": "Bearer not-a-jwt"})).items():
        assert r.status_code == 200, (path, r.text)
        assert r.headers["cache-control"].startswith("public"), path  # 지금과 같은 캐시 헤더


# ---------------------------------------------------------------- 판정 한 번 · fail-closed
async def test_decided_once_per_request(client, switch, calls, monkeypatch):
    n = []

    async def viewer(_creds):
        n.append(1)
        return User(id=1, role=UserRole.ADMIN, is_active=True)

    monkeypatch.setattr(market_access, "load_viewer", viewer)
    _assert_open(await _gql(client, {"Authorization": "Bearer x"}))  # 리졸버 7개 — 판정은 1번
    assert len(n) == 1
    assert (await client.get("/api/v1/market/movers", headers={"Authorization": "Bearer x"})).status_code == 200
    assert len(n) == 2


def test_switch_missing_row_is_off(monkeypatch):
    class _Rows:
        def scalars(self):
            return []  # 행 없음

    class _Session:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, _stmt):
            return _Rows()

    screener_features.clear_cache()
    monkeypatch.setattr(screener_features, "SyncSessionLocal", _Session)
    try:
        assert REAL_SWITCH() is False
    finally:
        screener_features.clear_cache()


def test_switch_db_error_is_off(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    screener_features.clear_cache()
    monkeypatch.setattr(screener_features, "SyncSessionLocal", boom)
    try:
        assert REAL_SWITCH() is False
    finally:
        screener_features.clear_cache()


def test_user_can_view_rules():
    assert market_access.user_can_view(None) is False
    assert market_access.user_can_view(User(role=UserRole.ADMIN, is_active=True)) is True
    assert market_access.user_can_view(User(role=UserRole.FREE, is_active=True, market_data_access=False)) is False
    assert market_access.user_can_view(User(role=UserRole.PREMIUM, is_active=True, market_data_access=False)) is False
    assert market_access.user_can_view(User(role=UserRole.FREE, is_active=True, market_data_access=True)) is True
    assert market_access.user_can_view(User(role=UserRole.FREE, is_active=False, market_data_access=True)) is False


def test_schema_execute_without_context_uses_switch(switch, calls):
    """라우터를 거치지 않은 직접 실행(context 없음)은 익명 — 스위치만 본다."""
    import asyncio

    res = asyncio.run(gql_schema.schema.execute("{ marketGroups { total } screenerFeatures { marketData } }"))
    assert res.errors is None and res.data == {"marketGroups": {"total": 0}, "screenerFeatures": {"marketData": False}}
    switch["on"] = True
    res = asyncio.run(gql_schema.schema.execute("{ marketGroups { total } screenerFeatures { marketData } }"))
    assert res.data == {"marketGroups": {"total": 1}, "screenerFeatures": {"marketData": True}}

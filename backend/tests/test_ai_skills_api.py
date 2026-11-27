"""AI Lab A단계 관리자 API — 카탈로그·정량 미리 보기·권한·404, Gemini 를 부르지 않음 (sqlite)."""
from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.ai_analyst.clients import gemini_client, opendart
from apps.ai_analyst.skills import service as svc
from apps.stock_api.main import app
from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base, User, UserRole

BASE = "/api/v1/admin/ai-skills"
FAKE = {"ticker": "005930", "name": "삼성전자", "as_of": "2026-11-26", "sepa": {"pass_count": 8}}


@pytest.fixture(autouse=True)
def no_external(monkeypatch):
    """Gemini·DART 를 부르면 바로 실패하게 — A단계는 둘 다 쓰지 않아야 한다(DART 는 저장소 안에서만, 여기선 가짜 결과)."""
    def _boom(*a, **k):
        raise AssertionError("A단계에서 외부 AI·공시 클라이언트를 부르면 안 됩니다")
    monkeypatch.setattr(gemini_client, "get_gemini_client", _boom)
    monkeypatch.setattr(opendart, "get_opendart_client", lambda: None)


@pytest.fixture
def preview(monkeypatch):
    calls: list = []

    def _fake(ticker, capital=10_000_000, risk_pct=1.0, as_of=None):
        calls.append((ticker, capital, risk_pct))
        return None if ticker == "999999" else {**FAKE, "ticker": ticker}
    monkeypatch.setattr(svc, "quant_preview", _fake)
    return calls


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
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
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, state
    app.dependency_overrides.clear()


async def _seed(maker, *, tier="ANALYST", role=UserRole.ADMIN):
    async with maker() as s:
        u = User(nickname="관리자", role=role, is_active=True, admin_tier=tier)
        s.add(u)
        await s.commit()
        return u


async def test_catalog_list_seven(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/catalog")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 7
    assert {"id", "name", "description", "source_repo", "license", "uses_facts"} <= set(body[0])
    assert "body" not in body[0]


async def test_catalog_detail_and_404(api, maker):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/catalog/sepa_strategy")
    assert r.status_code == 200 and r.json()["body"].strip()
    r = await client.get(f"{BASE}/catalog/nope")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NOT_FOUND"


async def test_quant_preview_ok_and_params(api, maker, preview):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/quant-preview/005930", params={"capital": 50_000_000, "risk_pct": 0.5})
    assert r.status_code == 200
    assert r.json()["ticker"] == "005930"
    assert preview == [("005930", 50_000_000, 0.5)]


async def test_quant_preview_default_params(api, maker, preview):
    client, state = api
    state["user"] = await _seed(maker)
    assert (await client.get(f"{BASE}/quant-preview/005930")).status_code == 200
    assert preview == [("005930", 10_000_000, 1.0)]


async def test_quant_preview_unknown_ticker_404(api, maker, preview):
    client, state = api
    state["user"] = await _seed(maker)
    r = await client.get(f"{BASE}/quant-preview/999999")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("params", [{"capital": 99_999}, {"capital": 1e11 + 1}, {"risk_pct": 0.09},
                                    {"risk_pct": 5.1}])
async def test_quant_preview_param_range_422(api, maker, preview, params):
    client, state = api
    state["user"] = await _seed(maker)
    assert (await client.get(f"{BASE}/quant-preview/005930", params=params)).status_code == 422
    assert preview == []


@pytest.mark.parametrize("tier,role,code", [
    ("EDITOR", UserRole.ADMIN, 403),
    ("ANALYST", UserRole.ADMIN, 200),
    (None, UserRole.FREE, 403),
])
async def test_permissions(api, maker, preview, tier, role, code):
    client, state = api
    state["user"] = await _seed(maker, tier=tier, role=role)
    assert (await client.get(f"{BASE}/catalog")).status_code == code
    assert (await client.get(f"{BASE}/catalog/k_dart")).status_code == code
    assert (await client.get(f"{BASE}/quant-preview/005930")).status_code == code


def test_skills_package_never_references_gemini():
    """정적 검사 — A단계 skills 패키지 코드는 Gemini 클라이언트를 import 하지 않는다."""
    root = Path(svc.__file__).parent
    for p in root.glob("*.py"):
        assert "gemini" not in p.read_text(encoding="utf-8").lower(), p.name


# ---------------- 서비스 묶음(가짜 저장소 — CH·PG·DART 접속 없음) ----------------

class _Session:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fake_repo(monkeypatch):
    from datetime import date, timedelta

    from apps.ai_analyst.skills import quant_repository as repo

    d0 = date(2026, 1, 1)
    bars = [{"date": d0 + timedelta(days=i), "open": 100 + i * 0.5, "high": (100 + i * 0.5) * 1.01,
             "low": (100 + i * 0.5) * 0.99, "close": 100 + i * 0.5, "volume": 1000.0} for i in range(260)]
    last = bars[-1]["date"]
    monkeypatch.setattr(repo, "load_daily_bars", lambda t, as_of=None: bars if t == "005930" else [])
    monkeypatch.setattr(repo, "load_canslim", lambda t, d: {"date": last, "market": "KOSPI", "sector_m": "0013",
                                                            "close": 229.5, "l_rs": 85, "avg_value_20d": 5e9})
    monkeypatch.setattr(repo, "load_name", lambda s, t: "삼성전자")
    monkeypatch.setattr(repo, "load_profile", lambda s, t: {"market": "KOSPI", "sector_m": "0013"})
    monkeypatch.setattr(repo, "load_breadth_rows",
                        lambda s, m, d: [{"close": 10.0, "ma20": 9.0, "ma50": 9.0}] * 7
                        + [{"close": 10.0, "ma20": 11.0, "ma50": 11.0}] * 3)
    monkeypatch.setattr(repo, "load_fundamentals", lambda t: {
        "annual": {"period": "Y", "stac_yymm": "202512", "eps": 22.95, "bps": 100.0, "roe": 15.0,
                   "sales_growth": 1.0, "op_growth": 2.0, "ni_growth": 3.0, "debt_ratio": 50.0},
        "quarters": [{"stac_yymm": f"2026{m:02d}", "op_growth": g, "sales_growth": 1.0, "ni_growth": 1.0,
                      "debt_ratio": 50.0} for m, g in ((3, 5.0), (6, 10.0), (9, 20.0))]})
    monkeypatch.setattr(repo, "load_sector_peers", lambda s, d: [
        {"ticker": "A", "close": 100.0, "eps": 10.0, "bps": 50.0, "roe": 10.0}])
    monkeypatch.setattr(repo, "load_dart", lambda t, as_of=None: [
        {"report_nm": "주요사항보고서(전환사채권발행결정)", "rcept_no": "1", "rcept_dt": "20261120", "url": "u"}])
    monkeypatch.setattr(svc, "SyncSessionLocal", _Session)
    return last


def test_service_quant_preview_bundle(fake_repo):
    import json

    out = svc.quant_preview("005930", capital=10_000_000, risk_pct=1.0)
    json.dumps(out)  # 날짜 등 모두 JSON 으로 바뀌어 있어야 함
    assert out["as_of"] == fake_repo.isoformat() and out["name"] == "삼성전자"
    assert out["sepa"]["pass_count"] == 8 and out["sepa"]["stage"] == 2
    assert out["market_breadth"]["regime"] == "BULL" and out["market_breadth"]["market"] == "KOSPI"
    assert out["position"]["shares"] > 0 and out["position_error"] is None
    assert out["dart"]["available"] is True and out["dart"]["overhang"] is True
    assert out["peer_valuation"]["target"]["per"] == 10.0 and out["peer_valuation"]["median"]["per"] == 10.0
    assert out["earnings_trend"]["accelerating"] is True
    assert set(out["backtest"]["setups"]) == {"A", "B", "C"}


def test_service_unknown_ticker_none(fake_repo):
    assert svc.quant_preview("999999") is None


def test_service_dart_unavailable(fake_repo, monkeypatch):
    from apps.ai_analyst.skills import quant_repository as repo

    monkeypatch.setattr(repo, "load_dart", lambda t, as_of=None: None)
    out = svc.quant_preview("005930")
    assert out["dart"]["available"] is False and out["dart"]["items"] == []


def test_repository_dart_none_without_key():
    from apps.ai_analyst.skills import quant_repository as repo

    assert repo.load_dart("005930") is None  # no_external 가 키 없음(None)으로 바꿔 둠


class _CH:
    """가짜 CH 클라이언트 — 쿼리 순서대로 준비한 행을 돌려주고 SQL·인자를 기록."""

    def __init__(self, *results):
        self.results = list(results)
        self.calls: list = []

    def query(self, sql, parameters=None):
        self.calls.append((sql, parameters))
        return type("R", (), {"result_rows": self.results.pop(0)})()


def test_repository_bars_and_fundamentals_shape():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    ch = _CH([(date(2026, 11, 26), 1, 2, 0.5, 1.5, 10), (date(2026, 11, 25), 1, 2, 0.5, 1.2, None)])
    bars = repo.load_daily_bars("005930", date(2026, 11, 26), client=ch)
    assert [b["date"] for b in bars] == [date(2026, 11, 25), date(2026, 11, 26)]  # 오름차순
    assert bars[0]["volume"] == 0.0
    assert "FINAL" in ch.calls[0][0] and ch.calls[0][1]["n"] == 520

    ch = _CH([("Q", "202609", 1, 1, 1, 1, 30.0, 1, 1), ("Y", "202512", 9, 9, 9, 9, 9, 9, 9),
              ("Q", "202606", 1, 1, 1, 1, 20.0, 1, 1), ("Q", "202603", 1, 1, 1, 1, 10.0, 1, 1),
              ("Q", "202512", 1, 1, 1, 1, 5.0, 1, 1), ("Q", "202509", 1, 1, 1, 1, 1.0, 1, 1)])
    f = repo.load_fundamentals("005930", client=ch)
    assert f["annual"]["stac_yymm"] == "202512"
    assert [q["stac_yymm"] for q in f["quarters"]] == ["202512", "202603", "202606", "202609"]
    assert "FINAL" in ch.calls[0][0]


def test_repository_sector_peers_two_queries():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    ch = _CH([("A", 100.0), ("B", 50.0)], [("A", 10.0, 50.0, 12.0)])
    peers = repo.load_sector_peers("0013", date(2026, 11, 26), client=ch)
    assert peers == [{"ticker": "A", "close": 100.0, "eps": 10.0, "bps": 50.0, "roe": 12.0},
                     {"ticker": "B", "close": 50.0, "eps": None, "bps": None, "roe": None}]
    assert len(ch.calls) == 2 and all("FINAL" in c[0] for c in ch.calls)
    assert "LIMIT 1 BY ticker" in ch.calls[1][0]
    assert repo.load_sector_peers("", date(2026, 11, 26), client=_CH()) == []

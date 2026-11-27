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


A_STAGE_MODULES = ("quant_facts.py", "quant_repository.py", "service.py", "skill_loader.py")


def test_a_stage_modules_never_reference_gemini():
    """정적 검사 — A단계 모듈(정량 엔진·미리 보기·로더)은 Gemini 클라이언트를 import 하지 않는다.
    B단계 추론(skill_runner·report_service·router 의 analyze)은 Gemini 를 쓰므로 대상에서 뺀다."""
    root = Path(svc.__file__).parent
    for name in A_STAGE_MODULES:
        assert "gemini" not in (root / name).read_text(encoding="utf-8").lower(), name


def test_skills_package_never_references_naver():
    """정적 검사 — skills 패키지(코드·카탈로그)에는 네이버 검색 데이터가 들어가지 않는다(AI 입력·저장 금지)."""
    root = Path(svc.__file__).parent
    for p in [*root.glob("*.py"), *root.glob("catalog/*/SKILL.md")]:
        text = p.read_text(encoding="utf-8").lower()
        assert "naver" not in text and "네이버" not in text, p.name


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
    monkeypatch.setattr(repo, "load_fundamentals", lambda t, as_of=None: {
        "annual": {"period": "Y", "stac_yymm": "202512", "eps": 22.95, "bps": 100.0, "roe": 15.0,
                   "sales_growth": 1.0, "op_growth": 2.0, "ni_growth": 3.0, "debt_ratio": 50.0},
        "quarters": [{"stac_yymm": f"2026{m:02d}", "op_growth": g, "sales_growth": 1.0, "ni_growth": 1.0,
                      "debt_ratio": 50.0} for m, g in ((3, 5.0), (6, 10.0), (9, 20.0))]})
    monkeypatch.setattr(repo, "load_sector_peers", lambda s, cd, pd, as_of=None: [
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


def test_repository_sector_peers_closes_from_daily_prices_on_price_date():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    cd, pd = date(2026, 11, 25), date(2026, 11, 26)
    ch = _CH([("A",), ("B",), ("C",)], [("A", 100.0), ("B", 50.0)], [("A", 10.0, 50.0, 12.0)])
    peers = repo.load_sector_peers("0013", cd, pd, client=ch)
    assert peers == [{"ticker": "A", "close": 100.0, "eps": 10.0, "bps": 50.0, "roe": 12.0},
                     {"ticker": "B", "close": 50.0, "eps": None, "bps": None, "roe": None}]  # C 는 그날 일봉 없음
    assert len(ch.calls) == 3 and all("FINAL" in c[0] for c in ch.calls)
    assert "canslim_daily" in ch.calls[0][0] and ch.calls[0][1]["d"] == cd
    assert "daily_prices" in ch.calls[1][0] and ch.calls[1][1]["d"] == pd
    assert "LIMIT 1 BY ticker" in ch.calls[2][0] and "stac_yymm <=" not in ch.calls[2][0]
    assert repo.load_sector_peers("", cd, pd, client=_CH()) == []


def test_repository_sector_peers_as_of_cutoff():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    ch = _CH([("A",)], [("A", 100.0)], [])
    repo.load_sector_peers("0013", date(2026, 3, 30), date(2026, 3, 31), as_of=date(2026, 3, 31), client=ch)
    sql, params = ch.calls[2]
    assert "stac_yymm <= %(ym)s" in sql and params["ym"] == "202512"  # 3/31 − 90일 = 12/31(월말) → 202512


@pytest.mark.parametrize("as_of,period,expected", [
    ("2026-03-31", "Y", "202512"),   # 90일 전 = 2025-12-31(월말) → 12월 결산 사용 가능
    ("2026-03-30", "Y", "202511"),   # 90일 전 = 2025-12-30 → 12월은 아직
    ("2026-05-15", "Q", "202603"),   # 45일 전 = 2026-03-31(월말)
    ("2026-05-14", "Q", "202602"),
])
def test_cutoff_yymm_boundaries(as_of, period, expected):
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    assert repo.cutoff_yymm(date.fromisoformat(as_of), period) == expected


def test_repository_fundamentals_as_of_excludes_future():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    rows = [("Y", "202612", 9, 9, 9, 9, 9, 9, 9), ("Q", "202609", 1, 1, 1, 1, 30.0, 1, 1),
            ("Q", "202606", 1, 1, 1, 1, 20.0, 1, 1), ("Y", "202512", 8, 8, 8, 8, 8, 8, 8),
            ("Q", "202603", 1, 1, 1, 1, 10.0, 1, 1), ("Q", "202512", 1, 1, 1, 1, 5.0, 1, 1)]
    f = repo.load_fundamentals("005930", as_of=date(2026, 8, 14), client=_CH(list(rows)))
    # 연간 컷 = 2026-05-16 이전 월말 → 202604, 분기 컷 = 2026-06-30 → 202606
    assert f["annual"]["stac_yymm"] == "202512"
    assert [q["stac_yymm"] for q in f["quarters"]] == ["202512", "202603", "202606"]
    latest = repo.load_fundamentals("005930", client=_CH(list(rows)))  # as_of 없으면 최신 그대로
    assert latest["annual"]["stac_yymm"] == "202612" and latest["quarters"][-1]["stac_yymm"] == "202609"


class _Dart:
    def __init__(self):
        self.calls: list = []

    def disclosures(self, t, days=90):
        self.calls.append(("recent", t, days))
        return []

    def disclosures_between(self, t, bgn, end):
        self.calls.append(("between", t, bgn, end))
        return []


def test_repository_dart_window(monkeypatch):
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    dart = _Dart()
    monkeypatch.setattr(opendart, "get_opendart_client", lambda: dart)
    assert repo.load_dart("005930") == []
    assert repo.load_dart("005930", as_of=date(2026, 11, 26)) == []
    assert dart.calls == [("recent", "005930", 90),
                          ("between", "005930", date(2026, 8, 28), date(2026, 11, 25))]  # as_of 전날까지


def test_repository_bars_zero_high_low_replaced_and_zero_close_dropped():
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    ch = _CH([(date(2026, 11, 26), 0, 0, 0, 100.0, 0),      # 거래정지일 — 고가·저가 0
              (date(2026, 11, 25), 0, 0, 0, 0, 0),          # 종가도 0 → 버림
              (date(2026, 11, 24), 99, 105, 95, 101.0, 10)])
    bars = repo.load_daily_bars("005930", client=ch)
    assert [b["date"] for b in bars] == [date(2026, 11, 24), date(2026, 11, 26)]
    assert bars[-1] == {"date": date(2026, 11, 26), "open": 100.0, "high": 100.0, "low": 100.0,
                        "close": 100.0, "volume": 0.0}
    assert bars[0]["low"] == 95.0


def test_catalog_uses_facts_match_preview_keys(fake_repo):
    """계약 — 카탈로그 uses_facts 키는 모두 quant_preview 결과의 최상위 키여야 한다(B단계 프롬프트 조립용)."""
    from apps.ai_analyst.skills import skill_loader

    keys = set(svc.quant_preview("005930"))
    for s in skill_loader.list_installed_skills():
        assert set(s["uses_facts"]) <= keys, (s["id"], set(s["uses_facts"]) - keys)


def test_service_split_cut_marks_and_trims(fake_repo, monkeypatch):
    from datetime import date, timedelta

    from apps.ai_analyst.skills import quant_repository as repo

    d0 = date(2025, 1, 1)
    closes = [1000.0] * 100 + [400.0] + [400.0 + i * 0.5 for i in range(1, 150)]  # 100번 봉 −60% 점프
    bars = [{"date": d0 + timedelta(days=i), "open": c, "high": c, "low": c, "close": c, "volume": 1000.0}
            for i, c in enumerate(closes)]
    monkeypatch.setattr(repo, "load_daily_bars", lambda t, as_of=None: bars)
    out = svc.quant_preview("005930")
    assert out["split_cut"] == {"date": (d0 + timedelta(days=100)).isoformat(), "jump_pct": -60.0, "dropped": 100}
    assert out["bars_used"] == 150
    assert out["sepa"]["evaluable"] is False  # 잘린 뒤 200봉 미만


def test_service_passes_as_of_to_fundamentals_and_peers(fake_repo, monkeypatch):
    from datetime import date

    from apps.ai_analyst.skills import quant_repository as repo

    seen: dict = {}
    orig_f, orig_p = repo.load_fundamentals, repo.load_sector_peers

    def _f(t, as_of=None):
        seen["fund"] = as_of
        return orig_f(t, as_of)

    def _p(s, cd, pd, as_of=None):
        seen["peers"] = (cd, pd, as_of)
        return orig_p(s, cd, pd, as_of)
    monkeypatch.setattr(repo, "load_fundamentals", _f)
    monkeypatch.setattr(repo, "load_sector_peers", _p)
    out = svc.quant_preview("005930", as_of=date(2026, 9, 17))
    assert seen["fund"] == date(2026, 9, 17)
    assert seen["peers"] == (fake_repo, fake_repo, date(2026, 9, 17))  # 업종 종가 = 일봉 날짜 d
    assert out["liquidity"]["canslim_date"] == fake_repo.isoformat()

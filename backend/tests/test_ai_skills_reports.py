"""AI Lab B단계 API·서비스 — 분석(저장분 재사용·force·키 없음·거부·잠금)·목록 페이징·upsert·일괄 분석 (sqlite + fakeredis, 가짜 Gemini)."""
from __future__ import annotations

from datetime import date

import fakeredis
import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import shared.ai_models  # noqa: F401 — 표 등록
import shared.daily_surge_models  # noqa: F401
from apps.ai_analyst.clients import gemini_client, opendart
from apps.ai_analyst.skills import report_repository as repo
from apps.ai_analyst.skills import report_service as rs
from apps.ai_analyst.skills import router as router_mod
from apps.ai_analyst.skills import service as quant_service
from apps.ai_analyst.skills.schemas import SkillAnalysisResponse
from apps.stock_api.main import app
from shared.auth import get_current_user
from shared.daily_surge_models import DailySurgeStock
from shared.database import get_db
from shared.models import Base, User, UserRole

BASE = "/api/v1/admin/ai-skills"
AS_OF = "2026-11-26"


def _preview(ticker="005930", as_of=AS_OF):
    return {
        "ticker": ticker, "name": "삼성전자", "as_of": as_of, "close": 10000.0,
        "sepa": {"pass_count": 7, "stage": 2}, "backtest": {"setups": {}}, "stop": {"stop": 9200.0},
        "position": {"shares": 125}, "position_error": None, "market_breadth": {"regime": "BULL"},
        "liquidity": {"rs": 85}, "split_cut": None,
        "dart": {"available": True, "days": 90, "overhang": False, "fatal": False, "positive_count": 1,
                 "negative_count": 0,
                 "items": [{"title": "단일판매ㆍ공급계약체결", "rcept_dt": "20261120", "rcept_no": "20261120000111",
                            "url": "u", "tag": "positive", "labels": ["공급계약"]}]},
        "peer_valuation": {}, "earnings_trend": {}, "annual": None,
    }


def _resp(verdict="STRONG_SETUP", bull_prob=30):
    node = {"title": "t", "evidence": "e"}
    return SkillAnalysisResponse.model_validate({
        "logic_chain": {"trigger": node, "business": node, "earnings_flow": node, "price_momentum": node},
        "thesis": {"signal": "MAINTAIN", "hypothesis": "h", "kill_switch": ["k"]},
        "ev_scenarios": {
            "bull": {"target_price": 13000, "probability_pct": bull_prob, "rationale": "r", "confidence": "HIGH"},
            "base": {"target_price": 11000, "probability_pct": 50, "rationale": "r", "confidence": "MEDIUM"},
            "bear": {"target_price": 9000, "probability_pct": 20, "rationale": "r", "confidence": "LOW"},
        },
        "dart_catalysts": [{"rcept_no": "20261120000111", "impact_grade": "deal_funding", "stars": 4,
                            "sentiment": 0.5, "interpretation": "i"}],
        "sepa_comment": "s", "exposure_comment": "x", "valuation_comment": "v",
        "overall_verdict": verdict, "executive_summary": ["첫 줄", "둘", "셋"],
    })


class FakeGemini:
    model = "gemini-fake"

    def __init__(self, resp):
        self.resp = resp
        self.calls = 0
        self.prompts: list[str] = []

    def generate_json(self, prompt, schema, *, system=None):
        self.calls += 1
        self.prompts.append(system + prompt)
        return self.resp


@pytest.fixture
def env(monkeypatch):
    """동기 sqlite(스레드 공용)·fakeredis·가짜 정량 미리 보기·가짜 Gemini."""
    engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(rs, "SyncSessionLocal", factory)
    redis = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(rs, "_redis", lambda: redis)
    monkeypatch.setattr(opendart, "get_opendart_client", lambda: None)
    monkeypatch.setattr(gemini_client, "get_gemini_client", lambda: (_ for _ in ()).throw(
        AssertionError("서비스는 rs._gemini 를 거쳐야 합니다")))
    state = {"gemini": FakeGemini(_resp()), "previews": {}}
    monkeypatch.setattr(rs, "_gemini", lambda: state["gemini"])

    def _qp(ticker, capital=10_000_000, risk_pct=1.0, as_of=None):
        if ticker == "999999":
            return None
        return state["previews"].get(ticker) or _preview(ticker)
    monkeypatch.setattr(quant_service, "quant_preview", _qp)
    state.update(factory=factory, redis=redis)
    yield state
    engine.dispose()


@pytest.fixture
async def api(env):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    auth: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return auth["user"]

    async def seed(tier="ANALYST", role=UserRole.ADMIN):
        async with maker() as s:
            u = User(nickname="관리자", role=role, is_active=True, admin_tier=tier)
            s.add(u)
            await s.commit()
            auth["user"] = u

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, seed
    app.dependency_overrides.clear()
    await engine.dispose()


# ---------------- 권한 ----------------

@pytest.mark.parametrize("tier,role,code", [("EDITOR", UserRole.ADMIN, 403), ("ANALYST", UserRole.ADMIN, 200),
                                            (None, UserRole.FREE, 403)])
async def test_permissions(api, env, tier, role, code):
    client, seed = api
    await seed(tier=tier, role=role)
    assert (await client.post(f"{BASE}/analyze/005930")).status_code == code
    assert (await client.get(f"{BASE}/reports")).status_code == code
    if code == 200:
        assert (await client.get(f"{BASE}/reports/005930")).status_code == 200
    else:
        assert (await client.get(f"{BASE}/reports/005930")).status_code == code


async def test_batch_top_requires_data_pipeline(api, env, monkeypatch):
    client, seed = api
    sent: list = []
    monkeypatch.setattr(router_mod.celery_app, "send_task",
                        lambda name, kwargs=None, **k: sent.append((name, kwargs)) or type("R", (), {"id": "t1"})())
    await seed(tier="ANALYST")  # SCREENER_VIEW 는 있지만 DATA_PIPELINE 없음
    assert (await client.post(f"{BASE}/batch-top")).status_code == 403
    await seed(tier="OPERATOR")
    r = await client.post(f"{BASE}/batch-top", params={"source": "leaders", "limit": 3})
    assert r.status_code == 202 and r.json() == {"task_id": "t1", "source": "leaders", "limit": 3}
    assert sent == [("ai.skills_batch_top", {"source": "leaders", "limit": 3})]
    assert (await client.post(f"{BASE}/batch-top", params={"limit": 6})).status_code == 422
    assert (await client.post(f"{BASE}/batch-top", params={"source": "news"})).status_code == 422
    env["redis"].set(rs.BATCH_LOCK_KEY, "x")
    assert (await client.post(f"{BASE}/batch-top")).status_code == 409
    assert len(sent) == 1


# ---------------- 분석 ----------------

async def test_analyze_saves_and_returns_report(api, env):
    client, seed = api
    await seed()
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.status_code == 200
    body = r.json()
    assert body["cached"] is False and body["ticker"] == "005930" and body["as_of_date"] == AS_OF
    assert body["model_name"] == "gemini-fake" and body["overall_verdict"] == "STRONG_SETUP"
    assert body["ev_scenarios"]["weighted_ev_pct"] == 12.0
    assert body["dart_catalysts"][0]["url"].endswith("rcpNo=20261120000111")
    assert body["exposure_and_sizing"]["position"] == {"shares": 125}
    assert env["gemini"].calls == 1
    assert not env["redis"].keys("ai:skills:analyze:*")  # 잠금 해제


async def test_analyze_reuses_saved_report_without_gemini(api, env):
    client, seed = api
    await seed()
    assert (await client.post(f"{BASE}/analyze/005930")).status_code == 200
    env["gemini"] = None  # 키가 없어도 저장분은 돌려준다
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.status_code == 200 and r.json()["cached"] is True


async def test_analyze_force_calls_gemini_again_and_upserts(api, env):
    client, seed = api
    await seed()
    first = (await client.post(f"{BASE}/analyze/005930")).json()
    env["gemini"] = FakeGemini(_resp(verdict="AVOID_RISK"))
    r = await client.post(f"{BASE}/analyze/005930", params={"force": "true"})
    assert r.status_code == 200 and env["gemini"].calls == 1
    body = r.json()
    assert body["cached"] is False and body["overall_verdict"] == "AVOID_RISK" and body["id"] == first["id"]
    with env["factory"]() as s:
        assert s.scalar(sa.text("SELECT count(*) FROM admin_ai_skill_reports")) == 1


async def test_analyze_new_as_of_makes_new_row(api, env):
    client, seed = api
    await seed()
    await client.post(f"{BASE}/analyze/005930")
    env["previews"]["005930"] = _preview(as_of="2026-11-27")
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.json()["cached"] is False and r.json()["as_of_date"] == "2026-11-27"
    latest = (await client.get(f"{BASE}/reports/005930")).json()
    assert latest["as_of_date"] == "2026-11-27"
    old = await client.get(f"{BASE}/reports/005930", params={"as_of": AS_OF})
    assert old.status_code == 200 and old.json()["as_of_date"] == AS_OF
    assert (await client.get(f"{BASE}/reports/005930", params={"as_of": "2026-01-02"})).status_code == 404


async def test_analyze_no_key_503(api, env):
    client, seed = api
    await seed()
    env["gemini"] = None
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "GEMINI_UNAVAILABLE"
    assert (await client.get(f"{BASE}/reports/005930")).status_code == 404  # 저장하지 않음


@pytest.mark.parametrize("resp,reason", [(None, "NO_RESPONSE"), ("bad", "VERDICT_INVALID")])
async def test_analyze_invalid_response_502(api, env, resp, reason):
    client, seed = api
    await seed()
    env["gemini"] = FakeGemini(_resp(verdict="BUY") if resp == "bad" else None)
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.status_code == 502
    assert r.json()["detail"] == {"code": "AI_RESPONSE_INVALID", "message": rs._MESSAGES["AI_RESPONSE_INVALID"],
                                  "reason": reason}
    assert (await client.get(f"{BASE}/reports")).json()["total"] == 0


async def test_analyze_unknown_ticker_404_and_locked_409(api, env):
    client, seed = api
    await seed()
    r = await client.post(f"{BASE}/analyze/999999")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "NOT_FOUND"
    env["redis"].set(rs.lock_key("005930"), "other")
    r = await client.post(f"{BASE}/analyze/005930")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ANALYZING"
    assert env["gemini"].calls == 0
    assert env["redis"].get(rs.lock_key("005930")) == "other"  # 남의 잠금은 풀지 않는다


async def test_analyze_skills_param(api, env):
    client, seed = api
    await seed()
    assert (await client.post(f"{BASE}/analyze/005930", params={"skills": "nope"})).status_code == 422
    r = await client.post(f"{BASE}/analyze/005930", params={"skills": "k_dart, logic_chain"})
    assert r.status_code == 200
    prompt = env["gemini"].prompts[0]
    assert "(k_dart)" in prompt and "(logic_chain)" in prompt and "(sepa_strategy)" not in prompt
    assert "네이버" not in prompt and "naver" not in prompt.lower()


# ---------------- 목록 페이징 ----------------

async def test_reports_paging_shape(api, env):
    client, seed = api
    await seed()
    for i, t in enumerate(["000001", "000002", "000003"]):
        env["previews"][t] = _preview(t, as_of=f"2026-11-2{i + 1}")
        assert (await client.post(f"{BASE}/analyze/{t}")).status_code == 200
    r = await client.get(f"{BASE}/reports", params={"page": 1, "page_size": 2})
    body = r.json()
    assert {k: body[k] for k in ("total", "page", "page_size", "pages")} == {"total": 3, "page": 1, "page_size": 2,
                                                                              "pages": 2}
    assert [x["ticker"] for x in body["items"]] == ["000003", "000002"]  # 최근 기준일 먼저
    item = body["items"][0]
    assert set(item) == {"id", "ticker", "stock_name", "as_of_date", "overall_verdict", "signal", "weighted_ev_pct",
                         "headline", "model_name", "created_at", "updated_at"}
    assert item["headline"] == "첫 줄" and item["signal"] == "MAINTAIN" and item["weighted_ev_pct"] == 12.0
    last = (await client.get(f"{BASE}/reports", params={"page": 9, "page_size": 2})).json()
    assert last["page"] == 2 and [x["ticker"] for x in last["items"]] == ["000001"]  # 범위 밖 → 마지막 쪽
    one = (await client.get(f"{BASE}/reports", params={"ticker": "000002"})).json()
    assert one["total"] == 1 and one["items"][0]["ticker"] == "000002"
    assert (await client.get(f"{BASE}/reports", params={"page_size": 101})).status_code == 422


# ---------------- 일괄 분석(서비스 — Celery 태스크 본문) ----------------

def _surge(factory, d, rows, close=10_000, value=5_000_000_000):
    with factory() as s:
        for t, rank in rows:
            s.add(DailySurgeStock(trade_date=d, ticker=t, name=t, market="KOSDAQ", close=close, prev_close=close,
                                  change_price=0, change_rate=10, volume=1, trading_value=value,
                                  is_surge=rank is not None, surge_rank=rank))
        s.commit()


def test_batch_surge_targets_latest_day(env):
    _surge(env["factory"], date(2026, 11, 25), [("OLD001", 1)])
    _surge(env["factory"], date(2026, 11, 26), [("B", 2), ("A", 1), ("C", None)])
    assert rs.batch_targets("surge", 5) == ["A", "B"]
    assert rs.batch_targets("surge", 1) == ["A"]


def test_batch_surge_skips_illiquid_penny_stocks(env):
    """동전주(1,000원 미만)이면서 거래대금 10억 미만이면 대상에서 뺀다. 둘 중 하나만 해당하면 남긴다."""
    d = date(2026, 11, 26)
    _surge(env["factory"], d, [("PENNY", 1)], close=850, value=300_000_000)       # 빠짐
    _surge(env["factory"], d, [("PENNYOK", 2)], close=850, value=2_000_000_000)   # 동전주지만 거래 많음
    _surge(env["factory"], d, [("THIN", 3)], close=15_000, value=300_000_000)     # 거래 적지만 동전주 아님
    _surge(env["factory"], d, [("EDGE", 4)], close=1_000, value=999_999_999)      # 1,000원은 동전주 아님
    assert rs.batch_targets("surge", 5) == ["PENNYOK", "THIN", "EDGE"]


def test_batch_leaders_uses_canslim_screen(env, monkeypatch):
    from apps.stock_api.services import canslim_query

    seen = {}

    def _screen(**kw):
        seen.update(kw)
        return {"date": AS_OF, "items": [{"ticker": "L1"}, {"ticker": "L2"}]}
    monkeypatch.setattr(canslim_query, "screen", _screen)
    assert rs.batch_targets("leaders", 9) == ["L1", "L2"]
    assert seen["limit"] == 5 and seen["sort"] == "score" and seen["liquid_only"] is True


def test_batch_skips_today_reports_and_counts(env, monkeypatch):
    monkeypatch.setattr(rs, "_today", lambda: date(2026, 11, 26))
    _surge(env["factory"], date(2026, 11, 26), [("A", 1), ("B", 2), ("999999", 3)])
    assert rs.analyze("A")["cached"] is False  # A 는 오늘(as_of=11-26) 리포트가 이미 있음
    env["gemini"] = FakeGemini(_resp())
    out = rs.batch_top("surge", 5)
    assert out["analyzed"] == ["B"]
    assert {"ticker": "A", "reason": "TODAY_EXISTS"} in out["skipped"]
    assert out["failed"] == [{"ticker": "999999", "reason": "NOT_FOUND"}]
    assert env["gemini"].calls == 1
    assert not env["redis"].exists(rs.BATCH_LOCK_KEY)


def test_batch_stops_without_key_and_locked(env):
    _surge(env["factory"], date(2026, 11, 26), [("A", 1), ("B", 2)])
    env["gemini"] = None
    out = rs.batch_top("surge", 5)
    assert out["stopped"] == "GEMINI_UNAVAILABLE" and out["analyzed"] == []
    env["redis"].set(rs.BATCH_LOCK_KEY, "x")
    assert rs.batch_top("surge", 5) == {"skipped": "locked"}
    assert rs.batch_top("news", 5) == {"error": "unknown source news"}


def test_celery_task_registered_and_delegates(env, monkeypatch):
    from apps.ai_analyst import tasks

    monkeypatch.setattr(rs, "batch_top", lambda source, limit: {"source": source, "limit": limit})
    assert tasks.skills_batch_top.name == "ai.skills_batch_top"
    assert tasks.skills_batch_top.run("leaders", 2) == {"source": "leaders", "limit": 2}


def test_repository_upsert_keeps_one_row_and_updates(env):
    from apps.ai_analyst.skills import skill_runner

    valid, _ = skill_runner.validate_response(_resp(), _preview())
    values = skill_runner.build_report_values(_preview(), valid, "m1")
    with env["factory"]() as s:
        a = repo.upsert(s, values)
        b = repo.upsert(s, {**values, "model_name": "m2", "overall_verdict": "HOLD_WAIT"})
        assert a["id"] == b["id"] and b["model_name"] == "m2" and b["overall_verdict"] == "HOLD_WAIT"
        assert s.scalar(sa.text("SELECT count(*) FROM admin_ai_skill_reports")) == 1

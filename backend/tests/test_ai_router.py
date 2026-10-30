"""AI 시황 공개 REST — 5개 엔드포인트 200·빈 모양, 캐시 적중, last 폴백, 입력 검증 4xx, 장애 시 200.

실제 외부 호출 0회: Redis 는 fakeredis, PG 는 sqlite 메모리, ClickHouse 트리맵은 monkeypatch.
"""
from __future__ import annotations

from datetime import date

import fakeredis
import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from apps.ai_analyst import cache
from apps.ai_analyst import repository as repo
from apps.ai_analyst import router as ai_router
from apps.ai_analyst.schemas import MorningBriefingResponse, ScreenerQualitativeResponse
from apps.stock_api.main import app
from apps.stock_api.services import market_query
from shared.ai_models import AiDailyBriefing, AiStockEvaluation


def _boom(*a, **k):
    raise AssertionError("실제 외부 호출 시도")


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    for k in ("GEMINI_API_KEY", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET", "OPENDART_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(cache, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(market_query, "treemap", _boom)  # 기본은 ClickHouse 접속 금지
    return fake


@pytest.fixture(autouse=True)
def pg(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    AiDailyBriefing.__table__.create(engine)
    AiStockEvaluation.__table__.create(engine)
    factory = sessionmaker(engine)
    monkeypatch.setattr(ai_router, "SyncSessionLocal", factory)
    return factory


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------- 빈 모양(키·캐시·데이터 없음)
async def test_morning_brief_empty(client):
    r = await client.get("/api/v1/market/morning-brief")
    assert r.status_code == 200
    assert r.json() == {"brief": None}
    assert r.headers["cache-control"] == "public, max-age=30"


async def test_movers_empty(client):
    r = await client.get("/api/v1/market/movers")
    assert r.status_code == 200
    assert r.json() == {"updated_at": None, "gainers": [], "losers": [], "keywords": []}


async def test_investor_flow_empty(client):
    r = await client.get("/api/v1/market/investor-flow")
    assert r.status_code == 200
    assert r.json() == {"date": None, "source": None, "foreign_top": [], "institution_top": [], "pension_top": [],
                        "double_buy": [], "ai_comment": None, "updated_at": None}


async def test_screener_analysis_empty(client):
    r = await client.get("/api/v1/ai/screener-analysis/005930")
    assert r.status_code == 200
    assert r.json() == {"analysis": None}


# ---------------------------------------------------------------- 데이터 있음
async def test_morning_brief_latest(client, pg):
    with pg() as s:
        repo.upsert_briefing(s, date(2026, 10, 29), MorningBriefingResponse(
            headline="미 증시 반등", us_market_summary="u", kr_impact_summary="k",
            bullish_sectors=[{"sector": "반도체", "reason": "r"}], bearish_sectors=[], macro_checkpoints=["CPI"]))
    body = (await client.get("/api/v1/market/morning-brief")).json()["brief"]
    assert body["headline"] == "미 증시 반등"
    assert body["date"] == "2026-10-29"
    assert body["bullish_sectors"] == [{"sector": "반도체", "reason": "r"}]
    assert set(body) >= {"us_market_summary", "kr_impact_summary", "bearish_sectors", "macro_checkpoints",
                         "created_at"}


async def test_screener_analysis_found_lowercase_ticker(client, pg):
    with pg() as s:
        repo.upsert_evaluation(s, date(2026, 10, 30), ScreenerQualitativeResponse(
            ticker="00088K", hook_summary="신고가 돌파", growth_quality="본업성장", financial_quality_note="n",
            red_flag_level="WARNING", red_flags=["CB 전환 물량"]))
    r = await client.get("/api/v1/ai/screener-analysis/00088k")  # 소문자도 정규화
    assert r.status_code == 200
    a = r.json()["analysis"]
    assert a["ticker"] == "00088K" and a["red_flag_level"] == "WARNING" and a["red_flags"] == ["CB 전환 물량"]
    assert a["date"] == "2026-10-30"


MOVERS = {"updated_at": "2026-10-30T10:00:00+09:00",
          "gainers": [{"ticker": "005930", "stock_name": "삼성전자", "price": 70000.0, "change_rate": 5.1,
                       "reason_summary": "수주", "category": "수주계약", "reliability": "상", "risk_warning": None}],
          "losers": []}
KEYWORDS = [{"keyword": "HBM", "background": "b", "tickers": ["005930"]}]


async def test_movers_today_cache(client, fake_redis):
    cache.put_json(cache.MOVERS_KEY, MOVERS, 600)
    cache.put_json(cache.KEYWORDS_KEY, KEYWORDS, 1800)
    cache.put_json(cache.MOVERS_LAST_KEY, {**MOVERS, "updated_at": "옛날"}, 100)
    assert (await client.get("/api/v1/market/movers")).json() == {**MOVERS, "keywords": KEYWORDS}


async def test_movers_falls_back_to_last(client, fake_redis):
    cache.put_json(cache.MOVERS_LAST_KEY, MOVERS, cache.LAST_TTL)
    cache.put_json(cache.KEYWORDS_LAST_KEY, KEYWORDS, cache.LAST_TTL)
    assert (await client.get("/api/v1/market/movers")).json() == {**MOVERS, "keywords": KEYWORDS}


async def test_investor_flow_cache(client, fake_redis):
    flow = {"date": "2026-10-30", "source": "kis",
            "foreign_top": [{"ticker": "005930", "name": "삼성전자", "net_amount": 1_000_000_000}],
            "institution_top": [], "pension_top": [],
            "double_buy": [{"ticker": "005930", "name": "삼성전자", "foreign_amount": 1, "institution_amount": 2}],
            "ai_comment": "외국인 반도체 매수", "updated_at": "2026-10-30T15:45:00+09:00"}
    cache.put_json(cache.INVESTOR_FLOW_KEY, flow, 100)
    assert (await client.get("/api/v1/market/investor-flow")).json() == flow


# ---------------------------------------------------------------- 트리맵 위임·검증
async def test_heatmap_delegates_to_treemap_service(client, monkeypatch):
    calls = []
    out = {"date": "2026-10-30", "groups": [{"id": "G1", "name": "반도체", "chg": 1.2, "size": 10.0,
                                             "stocks": [{"ticker": "005930", "name": "삼성전자", "chg": 1.5,
                                                         "size": 10.0}]}]}

    def fake(kind="sector", size="mcap", period="1d"):
        calls.append((kind, size, period))
        return out

    monkeypatch.setattr(market_query, "treemap", fake)
    r = await client.get("/api/v1/market/heatmap", params={"kind": "theme", "size": "value", "period": "5d"})
    assert r.status_code == 200 and r.json() == out
    assert calls == [("theme", "value", "5d")]
    r = await client.get("/api/v1/market/heatmap")  # 기본값
    assert calls[-1] == ("sector", "mcap", "1d")


@pytest.mark.parametrize("params,code", [({"kind": "foo"}, "INVALID_KIND"), ({"size": "x"}, "INVALID_SIZE"),
                                         ({"period": "1y"}, "INVALID_PERIOD")])
async def test_heatmap_invalid_param(client, params, code):
    r = await client.get("/api/v1/market/heatmap", params=params)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == code and r.json()["detail"]["message"]


async def test_heatmap_clickhouse_down_returns_empty(client, monkeypatch):
    def down(*a, **k):
        raise ConnectionError("CH 장애")

    monkeypatch.setattr(market_query, "treemap", down)
    r = await client.get("/api/v1/market/heatmap")
    assert r.status_code == 200 and r.json() == {"date": None, "groups": []}


@pytest.mark.parametrize("bad", ["12345", "1234567", "00593!", "abc-12"])
async def test_screener_analysis_invalid_ticker(client, bad):
    r = await client.get(f"/api/v1/ai/screener-analysis/{bad}")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "INVALID_TICKER"


# ---------------------------------------------------------------- 장애에도 200
async def test_redis_down_returns_empty(client, monkeypatch):
    class Down:
        def get(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(cache, "get_sync_redis", lambda: Down())
    assert (await client.get("/api/v1/market/movers")).json()["gainers"] == []
    assert (await client.get("/api/v1/market/investor-flow")).json()["foreign_top"] == []


async def test_pg_down_returns_null(client, monkeypatch):
    def down():
        raise ConnectionError("pg down")

    monkeypatch.setattr(ai_router, "SyncSessionLocal", down)
    r1 = await client.get("/api/v1/market/morning-brief")
    r2 = await client.get("/api/v1/ai/screener-analysis/005930")
    assert (r1.status_code, r1.json()) == (200, {"brief": None})
    assert (r2.status_code, r2.json()) == (200, {"analysis": None})

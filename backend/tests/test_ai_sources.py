"""AI 요약 근거 기사(R3) — sources 채움(최대 3, originallink 우선), 뉴스 없으면 [], 옛 캐시·옛 행 호환, LLM 스키마 제외.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §4
"""
from __future__ import annotations

import importlib.util
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import fakeredis
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from apps.ai_analyst import cache
from apps.ai_analyst import repository as repo
from apps.ai_analyst import schemas as s
from apps.ai_analyst.clients.naver_news import NewsItem
from apps.ai_analyst.services import market_movers as mm
from apps.ai_analyst.services import morning_brief as mb
from apps.ai_analyst.services import stock_qualitative as sq
from apps.ai_analyst.sources import MAX_SOURCES, news_sources
from shared.ai_models import AiDailyBriefing, AiStockEvaluation

KST = ZoneInfo("Asia/Seoul")
DAY = date(2026, 10, 30)
NOW = datetime(2026, 10, 30, 10, 0, tzinfo=KST)


def _item(i: int, *, original=True, link=True) -> NewsItem:
    return NewsItem(title=f"기사{i}", description="d", originallink=f"https://press.example/{i}" if original else "",
                    link=f"https://n.news.example/{i}" if link else "", pub_date="Thu, 30 Oct 2026 09:12:00 +0900")


# ── 순수 함수 ─────────────────────────────────────────


def test_news_sources_max3_originallink_first():
    got = news_sources([_item(1), _item(2, original=False), _item(3, original=False, link=False), _item(4), _item(5)])
    assert len(got) == MAX_SOURCES == 3
    assert got[0] == {"title": "기사1", "url": "https://press.example/1", "pub_date": "2026-10-30T09:12:00+09:00"}
    assert got[1]["url"] == "https://n.news.example/2"  # originallink 없으면 link
    assert [g["title"] for g in got] == ["기사1", "기사2", "기사4"]  # 링크가 하나도 없는 기사는 뺀다


def test_news_sources_empty_and_dicts_and_dedupe():
    assert news_sources(None) == [] and news_sources([]) == []
    d = {"title": "딕트", "originallink": "https://a.example/x", "link": "", "pub_date": "깨진 날짜"}
    assert news_sources([d, d]) == [{"title": "딕트", "url": "https://a.example/x", "pub_date": None}]


def test_llm_schemas_have_no_sources():
    for model in (s.MorningBriefingResponse, s.MoverReasonItem, s.MoverReasonsResponse,
                  s.ScreenerQualitativeResponse, s.HotKeyword):
        assert "sources" not in model.model_fields
    assert s.Mover(ticker="1", stock_name="a", change_rate=1.0).model_dump()["sources"] == []


# ── 공통 픽스처 ───────────────────────────────────────


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    AiDailyBriefing.__table__.create(engine)
    AiStockEvaluation.__table__.create(engine)
    with Session(engine) as ss:
        yield ss


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    fake = fakeredis.FakeRedis()
    monkeypatch.setattr(cache, "get_sync_redis", lambda: fake)
    for mod in (mb, mm, sq):
        monkeypatch.setattr(mod, "_gemini", lambda: None)
        monkeypatch.setattr(mod, "_news", lambda: None)
    monkeypatch.setattr(sq, "_dart", lambda: None)
    monkeypatch.setattr(sq, "_fund_rows", lambda ticker: [])
    yield fake


class FakeGemini:
    def __init__(self, handlers):
        self.handlers = handlers

    def generate_json(self, prompt, schema, *, system=None):
        return self.handlers[schema](prompt)


class FakeNews:
    def __init__(self, n=5):
        self.n = n

    def search(self, query, *, display=5, sort="date"):
        return [_item(i) for i in range(self.n)]


# ── 모닝 브리핑 ───────────────────────────────────────

OVERVIEW = {"indices": [{"code": "US:SPX", "name": "S&P500", "date": "2026-10-29", "close": 6000.0, "chg1d": 1.2}],
            "macro": []}


def _brief(_p):
    return s.MorningBriefingResponse(headline="H", us_market_summary="u", kr_impact_summary="k",
                                     bullish_sectors=[], bearish_sectors=[], macro_checkpoints=[])


def test_brief_sources_filled_from_news(session, monkeypatch):
    monkeypatch.setattr(mb, "_gemini", lambda: FakeGemini({s.MorningBriefingResponse: _brief}))
    monkeypatch.setattr(mb, "_news", lambda: FakeNews())
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    got = mb.generate(DAY, session=session)
    assert [x["url"] for x in got["sources"]] == [f"https://press.example/{i}" for i in range(3)]
    assert mb.get_latest(DAY, session=session)["sources"] == got["sources"]


def test_brief_without_news_sources_empty(session, monkeypatch):
    monkeypatch.setattr(mb, "_gemini", lambda: FakeGemini({s.MorningBriefingResponse: _brief}))
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    assert mb.generate(DAY, session=session)["sources"] == []


def test_old_brief_row_null_sources_is_empty_list(session):
    repo.upsert_briefing(session, DAY, _brief(None))
    session.execute(text("UPDATE ai_daily_briefings SET sources = NULL"))
    session.commit()
    assert repo.get_briefing(session, DAY)["sources"] == []


# ── 급등락 ────────────────────────────────────────────


def _kis_row(ticker, name, rate):
    return {"ticker": ticker, "name": name, "price": 1000.0, "change_rate": rate}


class FakeKis:
    pass


def test_movers_sources_attached_per_reason(monkeypatch):
    up = [_kis_row("000001", "상승1", 10.0), _kis_row("000002", "상승2", 9.0)]
    down = [_kis_row("000101", "하락1", -9.0)]
    monkeypatch.setattr(mm, "_fetch", lambda client, desc: up if desc else down)
    monkeypatch.setattr(mm, "_universe", lambda: {"000001", "000002", "000101"})
    monkeypatch.setattr(mm, "_news", lambda: FakeNews())

    def reasons(_p):  # 000002 는 Gemini 가 빠뜨린다 → 원인도 출처도 없음
        return s.MoverReasonsResponse(items=[
            s.MoverReasonItem(ticker="000001", stock_name="상승1", change_rate=10.0, reason_summary="수주",
                              category="수주계약", reliability="상"),
            s.MoverReasonItem(ticker="000101", stock_name="하락1", change_rate=-9.0, reason_summary="악재",
                              category="실적부진", reliability="중"),
        ])

    monkeypatch.setattr(mm, "_gemini", lambda: FakeGemini({s.MoverReasonsResponse: reasons}))
    out = mm.analyze(NOW, kis_client=FakeKis())
    by = {m["ticker"]: m for m in out["gainers"] + out["losers"]}
    assert len(by["000001"]["sources"]) == 3 and by["000001"]["sources"][0]["url"] == "https://press.example/0"
    assert by["000002"]["sources"] == []
    assert len(by["000101"]["sources"]) == 3
    # 2분 순위 갱신(refresh_list)도 저장된 원인의 출처를 그대로 붙인다
    again = mm.refresh_list(NOW.replace(minute=2), kis_client=FakeKis())
    assert len({m["ticker"]: m for m in again["gainers"]}["000001"]["sources"]) == 3
    assert mm.get_cached()["gainers"][0]["sources"]


def test_movers_old_cache_without_sources_compatible():
    old = {"updated_at": "t", "gainers": [{"ticker": "005930", "stock_name": "삼성전자", "price": 1.0,
                                           "change_rate": 5.0, "reason_summary": "r", "category": "c",
                                           "reliability": "상", "risk_warning": None}], "losers": []}
    cache.put_json(cache.MOVERS_KEY, old, 60)
    got = mm.get_cached()
    assert got["gainers"][0]["sources"] == [] and got["gainers"][0]["reason_summary"] == "r"
    # 옛 원인 캐시(sources 없음)도 그대로 읽힌다
    cache.put_json(cache.MOVERS_REASONS_KEY, {"date": "2026-10-30", "items": {
        "005930": {"side": "up", "reason_summary": "r", "category": "c", "reliability": "상", "risk_warning": None}}},
        60)
    m = mm._attach([_kis_row("005930", "삼성전자", 5.0)], mm._load_reasons("2026-10-30"), "up")[0]
    assert m["reason_summary"] == "r" and m["sources"] == []


# ── 종목 정성 분석 ────────────────────────────────────


def _qual(_p):
    return s.ScreenerQualitativeResponse(ticker="005930", hook_summary="h", growth_quality="본업성장",
                                         financial_quality_note="n", red_flag_level="CLEAN", red_flags=[])


def test_qualitative_sources(session):
    g = FakeGemini({s.ScreenerQualitativeResponse: _qual})
    got = sq.evaluate(DAY, "005930", "삼성전자", None, session=session, news=FakeNews(2), gemini=g)
    assert [x["title"] for x in got["sources"]] == ["기사0", "기사1"]
    assert repo.get_latest_evaluation(session, "005930")["sources"] == got["sources"]


def test_qualitative_no_news_sources_empty(session):
    g = FakeGemini({s.ScreenerQualitativeResponse: _qual})
    got = sq.evaluate(DAY, "005930", "삼성전자", None, session=session, gemini=g)
    assert got["sources"] == []
    assert repo.get_latest_evaluation(session, "005930")["sources"] == []


# ── 마이그레이션 ──────────────────────────────────────


def test_migration_meta():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "d5e7f9a1b3c5_ai_sources.py"
    spec = importlib.util.spec_from_file_location("mig_ai_sources", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == "d5e7f9a1b3c5" and mod.down_revision == "c4d6e8f0a2b3"
    assert AiDailyBriefing.__table__.c.sources.nullable is True
    assert AiStockEvaluation.__table__.c.sources.nullable is True

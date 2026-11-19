"""AI 요약 근거 기사(R3) — 순수 함수(news_sources)는 유지하되, 네이버 약관 개정(2026-09-07 시행)으로
세 서비스(모닝 브리핑·급등락·정성 분석)는 네이버 뉴스를 부르지 않고 sources 를 언제나 [] 로 저장·응답한다.
옛 캐시·옛 행에 남은 뉴스 근거 기사도 응답에서 빠지는지 확인한다.

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §4,
      docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 6절 6번
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
from apps.ai_analyst.clients import naver_news
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
        assert not hasattr(mod, "_news")  # 서비스에 네이버 뉴스 래퍼가 남아 있으면 안 된다
    _block_naver(monkeypatch)
    monkeypatch.setattr(sq, "_dart", lambda: None)
    monkeypatch.setattr(sq, "_fund_rows", lambda ticker: [])
    yield fake


class FakeGemini:
    def __init__(self, handlers):
        self.handlers = handlers

    def generate_json(self, prompt, schema, *, system=None):
        return self.handlers[schema](prompt)


def _naver_called(*a, **k):
    raise AssertionError("네이버 뉴스 검색이 호출됨 — 약관상 AI 입력 금지")


def _block_naver(monkeypatch):
    """어떤 경로로든 네이버 클라이언트를 만들거나 검색하면 실패하게 — 키가 있어도 부르지 않아야 한다."""
    monkeypatch.setenv("NAVER_SEARCH_CLIENT_ID", "x")
    monkeypatch.setenv("NAVER_SEARCH_CLIENT_SECRET", "y")
    monkeypatch.setattr(naver_news, "get_naver_news_client", _naver_called)
    monkeypatch.setattr(naver_news.NaverNewsClient, "search", _naver_called)


class FakeNews:
    """옛 호출부 호환 인자(news=)로 넘겨도 쓰이면 안 된다 — search 가 불리면 실패."""

    def __init__(self, n=5):
        self.n = n

    def search(self, query, *, display=5, sort="date"):
        raise AssertionError("뉴스 검색이 호출됨")


# ── 모닝 브리핑 ───────────────────────────────────────

OVERVIEW = {"indices": [{"code": "US:SPX", "name": "S&P500", "date": "2026-10-29", "close": 6000.0, "chg1d": 1.2}],
            "macro": []}


def _brief(_p):
    return s.MorningBriefingResponse(headline="H", us_market_summary="u", kr_impact_summary="k",
                                     bullish_sectors=[], bearish_sectors=[], macro_checkpoints=[])


def test_brief_never_uses_news_even_with_naver_key(session, monkeypatch):
    prompts_seen = []

    def brief(p):
        prompts_seen.append(p)
        return _brief(p)

    monkeypatch.setattr(mb, "_gemini", lambda: FakeGemini({s.MorningBriefingResponse: brief}))
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    got = mb.generate(DAY, session=session)
    assert got["sources"] == [] and "뉴스" not in prompts_seen[0]
    assert repo.get_briefing(session, DAY)["sources"] == []  # PG 에도 저장하지 않는다
    assert mb.get_latest(DAY, session=session)["sources"] == []


def test_old_brief_row_news_sources_hidden(session):
    """약관 개정 전 행에 남은 뉴스 근거 기사는 API 응답에서 뺀다(최근 1건 폴백으로 옛 행이 나와도)."""
    repo.upsert_briefing(session, DAY, _brief(None), sources=news_sources([_item(1)]))
    assert repo.get_briefing(session, DAY)["sources"]  # 저장소에는 남아 있다(정리는 운영 작업)
    assert mb.get_latest(date(2026, 11, 2), session=session)["sources"] == []


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


def test_movers_reasons_without_news_have_no_sources(monkeypatch, _isolate):
    """원인 분석을 켜도(기본 꺼짐) 뉴스는 넣지 않고 근거 기사도 저장·응답하지 않는다."""
    up = [_kis_row("000001", "상승1", 10.0), _kis_row("000002", "상승2", 9.0)]
    down = [_kis_row("000101", "하락1", -9.0)]
    monkeypatch.setattr(mm, "MOVER_REASONS_ENABLED", True)
    monkeypatch.setattr(mm, "_fetch", lambda client, desc: up if desc else down)
    monkeypatch.setattr(mm, "_universe", lambda: {"000001", "000002", "000101"})
    prompts_seen = []

    def reasons(p):  # 000002 는 Gemini 가 빠뜨린다 → 원인 없음
        prompts_seen.append(p)
        return s.MoverReasonsResponse(items=[
            s.MoverReasonItem(ticker="000001", stock_name="상승1", change_rate=10.0, reason_summary="수주",
                              category="수주계약", reliability="상"),
            s.MoverReasonItem(ticker="000101", stock_name="하락1", change_rate=-9.0, reason_summary="악재",
                              category="실적부진", reliability="중"),
        ])

    monkeypatch.setattr(mm, "_gemini", lambda: FakeGemini({s.MoverReasonsResponse: reasons}))
    out = mm.analyze(NOW, kis_client=FakeKis())
    by = {m["ticker"]: m for m in out["gainers"] + out["losers"]}
    assert by["000001"]["reason_summary"] == "수주" and by["000002"]["reason_summary"] is None
    assert all(m["sources"] == [] for m in by.values())
    assert "뉴스 근거는 제공되지 않는다" in prompts_seen[0] and "관련 뉴스" not in prompts_seen[0]
    again = mm.refresh_list(NOW.replace(minute=2), kis_client=FakeKis())
    assert all(m["sources"] == [] for m in again["gainers"])
    assert all(m["sources"] == [] for m in mm.get_cached()["gainers"])
    # Redis 어디에도 뉴스 필드(sources·기사 링크)가 남지 않는다
    for key in _isolate.keys("*"):
        raw = _isolate.get(key).decode()
        assert "sources\": [{" not in raw and "press.example" not in raw and "pub_date" not in raw


_OLD_SOURCES = [{"title": "옛 기사", "url": "https://press.example/old", "pub_date": None}]


def test_movers_old_cache_news_hidden_when_reasons_off(monkeypatch):
    """약관 개정 전 캐시(뉴스 기반 원인·근거 기사·키워드)가 last 폴백(4일)으로 다시 나오지 않는다."""
    old = {"updated_at": "t", "gainers": [{"ticker": "005930", "stock_name": "삼성전자", "price": 1.0,
                                           "change_rate": 5.0, "reason_summary": "r", "category": "c",
                                           "reliability": "상", "risk_warning": None, "sources": _OLD_SOURCES}],
           "losers": []}
    cache.put_json(cache.MOVERS_LAST_KEY, old, 60)
    cache.put_json(cache.KEYWORDS_LAST_KEY, [{"keyword": "AI", "background": "뉴스 요약", "tickers": []}], 60)
    got = mm.get_cached()
    g = got["gainers"][0]
    assert g["ticker"] == "005930" and g["sources"] == [] and g["reason_summary"] is None and g["category"] is None
    assert got["keywords"] == []
    cache.put_json(cache.MOVERS_KEY, old, 60)
    hit = mm.analyze(NOW, kis_client=FakeKis())  # 캐시 적중 경로도 같은 규칙
    assert hit["gainers"][0]["sources"] == [] and hit["gainers"][0]["reason_summary"] is None
    # 옛 원인 캐시는 원인 분석이 꺼져 있으면 읽지 않는다(2분 회차마다 다시 붙지 않게)
    cache.put_json(cache.MOVERS_REASONS_KEY, {"date": "2026-10-30", "items": {
        "005930": {"side": "up", "reason_summary": "r", "category": "c", "reliability": "상", "risk_warning": None,
                   "sources": _OLD_SOURCES}}}, 60)
    assert mm._load_reasons("2026-10-30") == {}


def test_movers_old_reason_cache_compatible_when_enabled(monkeypatch):
    monkeypatch.setattr(mm, "MOVER_REASONS_ENABLED", True)
    cache.put_json(cache.MOVERS_REASONS_KEY, {"date": "2026-10-30", "items": {
        "005930": {"side": "up", "reason_summary": "r", "category": "c", "reliability": "상", "risk_warning": None,
                   "sources": _OLD_SOURCES}}}, 60)
    m = mm._attach([_kis_row("005930", "삼성전자", 5.0)], mm._load_reasons("2026-10-30"), "up")[0]
    assert m["reason_summary"] == "r" and m["sources"] == []  # 원인은 쓰되 옛 근거 기사는 버린다


# ── 종목 정성 분석 ────────────────────────────────────


def _qual(_p):
    return s.ScreenerQualitativeResponse(ticker="005930", hook_summary="h", growth_quality="본업성장",
                                         financial_quality_note="n", red_flag_level="CLEAN", red_flags=[])


def test_qualitative_ignores_news_argument(session):
    """옛 호출부가 news= 를 넘겨도 검색하지 않고(FakeNews.search 가 불리면 실패) 근거 기사도 없다."""
    prompts_seen = []

    def qual(p):
        prompts_seen.append(p)
        return _qual(p)

    g = FakeGemini({s.ScreenerQualitativeResponse: qual})
    got = sq.evaluate(DAY, "005930", "삼성전자", None, session=session, news=FakeNews(2), gemini=g)
    assert got["sources"] == [] and "뉴스" not in prompts_seen[0]
    assert repo.get_latest_evaluation(session, "005930")["sources"] == []


def test_qualitative_old_row_news_sources_hidden(session):
    repo.upsert_evaluation(session, DAY, _qual(None), sources=news_sources([_item(1)]))
    assert sq.get_latest("005930", session=session)["sources"] == []


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

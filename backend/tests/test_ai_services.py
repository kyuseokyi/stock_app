"""AI 시황 서비스 레이어 — 모닝 브리핑·급등락·수급 해설·정성 평가.

가짜 Gemini(호출 기록)·가짜 KIS·가짜 뉴스·fakeredis·sqlite 세션만 쓴다. 실제 외부 호출 0회:
autouse 픽스처가 키 env 를 지우고 모든 외부 래퍼를 기본 가짜로 바꿔 끼운다.
"""
from datetime import date, datetime
from zoneinfo import ZoneInfo

import fakeredis
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from apps.ai_analyst import cache
from apps.ai_analyst import repository as repo
from apps.ai_analyst.clients.opendart import Disclosure
from apps.ai_analyst.schemas import (
    HotKeywordsResponse,
    InvestorFlowComment,
    MorningBriefingResponse,
    MoverReasonsResponse,
    ScreenerQualitativeResponse,
)
from apps.ai_analyst.services import investor_flow_ai as flow
from apps.ai_analyst.services import market_movers as mm
from apps.ai_analyst.services import morning_brief as mb
from apps.ai_analyst.services import stock_qualitative as sq
from shared import market_calendar
from shared.ai_models import AiDailyBriefing, AiStockEvaluation

KST = ZoneInfo("Asia/Seoul")
DAY = date(2026, 10, 30)


# ---------------------------------------------------------------- 가짜들
class FakeGemini:
    """schema → 응답 생성 함수(prompt → 모델 | None). 호출을 기록한다."""

    def __init__(self, handlers=None):
        self.handlers = handlers or {}
        self.calls = []

    def generate_json(self, prompt, schema, *, system=None):
        self.calls.append((schema, prompt))
        h = self.handlers.get(schema)
        return h(prompt) if h else None


class FakeNews:
    def __init__(self):
        self.queries = []

    def search(self, query, *, display=5, sort="date"):
        self.queries.append((query, display, sort))
        return [{"title": f"{query} 기사", "description": "요약"}]


class FakeDart:
    def __init__(self, reports=()):
        self.reports = reports

    def disclosures(self, stock_code, *, days=90):
        return [Disclosure(report_nm=r, rcept_no="1", rcept_dt="20261020", flr_nm="x", corp_name="c")
                for r in self.reports]


def _kis_row(ticker, name, rate, rank):
    return {"stck_shrn_iscd": ticker, "hts_kor_isnm": name, "stck_prpr": "10000", "prdy_ctrt": str(rate),
            "acml_vol": "1000", "data_rank": str(rank)}


class FakeKis:
    def __init__(self, up, down, fail=False):
        self.up, self.down, self.fail, self.calls = up, down, fail, 0

    def get_fluctuation_ranking(self, *, descending, market_code):
        self.calls += 1
        if self.fail:
            raise RuntimeError("KIS 장애")
        return self.up if descending else self.down


def _boom(*a, **k):
    raise AssertionError("실제 외부 호출 시도")


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    for k in ("GEMINI_API_KEY", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET", "OPENDART_API_KEY",
              "KRX_ID", "KRX_PW", "TRADING_DAYS", "MARKET_HOLIDAYS"):
        monkeypatch.delenv(k, raising=False)
    fake = fakeredis.FakeRedis()
    monkeypatch.setattr(cache, "get_sync_redis", lambda: fake)
    for mod in (mb, mm, flow, sq):
        monkeypatch.setattr(mod, "_gemini", lambda: None)
    for mod in (mb, mm, sq):
        monkeypatch.setattr(mod, "_news", lambda: None)
    monkeypatch.setattr(sq, "_dart", lambda: None)
    monkeypatch.setattr(mb, "_overview", _boom)
    monkeypatch.setattr(mm, "_universe", _boom)
    monkeypatch.setattr(flow, "_collect", _boom)
    monkeypatch.setattr(flow, "_sector_map", lambda session=None: {})
    monkeypatch.setattr(sq, "_screen", _boom)
    yield fake


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    AiDailyBriefing.__table__.create(engine)
    AiStockEvaluation.__table__.create(engine)
    with Session(engine) as s:
        yield s


# ---------------------------------------------------------------- 모닝 브리핑
OVERVIEW = {
    "indices": [
        {"code": "US:SPX", "name": "S&P500", "date": "2026-10-29", "close": 6000.0, "chg1d": 1.2},
        {"code": "US:SOX", "name": "필라델피아 반도체", "date": "2026-10-29", "close": 5000.0, "chg1d": -0.5},
        {"code": "KR:0001", "name": "KOSPI", "date": "2026-10-29", "close": 2600.0, "chg1d": 0.3},
        {"code": "USSTK:AAPL", "name": "AAPL", "date": "2026-10-29", "close": 200.0, "chg1d": 0.1},
    ],
    "macro": [{"series_id": "DGS10", "name": "미 국채 10년", "unit": "%", "date": "2026-10-28", "value": 4.1,
               "prev": 4.0}],
}


def _brief_resp(_p):
    return MorningBriefingResponse(headline="H" * 300, us_market_summary="u", kr_impact_summary="k",
                                   bullish_sectors=[{"sector": "반도체", "reason": "r"}], bearish_sectors=[],
                                   macro_checkpoints=["CPI"])


def test_brief_no_key_returns_none(session, monkeypatch):
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    assert mb.generate(DAY, session=session) is None


def test_brief_generates_and_stores(session, monkeypatch):
    g = FakeGemini({MorningBriefingResponse: _brief_resp})
    monkeypatch.setattr(mb, "_gemini", lambda: g)
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    got = mb.generate(DAY, session=session)
    assert got["date"] == "2026-10-30" and len(got["headline"]) == 255
    prompt = g.calls[0][1]
    assert "S&P500 [2026-10-29]" in prompt and "+1.20%" in prompt and "AAPL" not in prompt
    assert "미국 증시 관련 뉴스" not in prompt  # 뉴스 키 없으면 섹션 자체 생략
    assert "미 국채 10년(%" in prompt
    assert mb.get_latest(DAY, session=session)["date"] == "2026-10-30"


def test_brief_db_hit_skips_gemini(session, monkeypatch):
    g = FakeGemini({MorningBriefingResponse: _brief_resp})
    monkeypatch.setattr(mb, "_gemini", lambda: g)
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    repo.upsert_briefing(session, DAY, _brief_resp(None).model_copy(update={"headline": "기존"}))
    assert mb.generate(DAY, session=session)["headline"] == "기존"
    assert g.calls == []
    mb.generate(DAY, session=session, force=True)
    assert len(g.calls) == 1


def test_brief_yesterday_row_is_not_a_hit(session, monkeypatch):
    g = FakeGemini({MorningBriefingResponse: _brief_resp})
    monkeypatch.setattr(mb, "_gemini", lambda: g)
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    repo.upsert_briefing(session, date(2026, 10, 29), _brief_resp(None))
    assert mb.generate(DAY, session=session)["date"] == "2026-10-30"
    assert len(g.calls) == 1


def test_brief_without_indices_skips(session, monkeypatch):
    g = FakeGemini({MorningBriefingResponse: _brief_resp})
    monkeypatch.setattr(mb, "_gemini", lambda: g)
    monkeypatch.setattr(mb, "_overview", lambda: {"indices": [], "macro": []})
    assert mb.generate(DAY, session=session) is None and g.calls == []


def test_brief_with_news_includes_section(session, monkeypatch):
    g = FakeGemini({MorningBriefingResponse: _brief_resp})
    news = FakeNews()
    monkeypatch.setattr(mb, "_gemini", lambda: g)
    monkeypatch.setattr(mb, "_news", lambda: news)
    monkeypatch.setattr(mb, "_overview", lambda: OVERVIEW)
    mb.generate(DAY, session=session)
    assert news.queries == [("뉴욕증시", 5, "date")] and "미국 증시 관련 뉴스" in g.calls[0][1]


# ---------------------------------------------------------------- 급등락
UP = [_kis_row(f"{i:06d}", f"상승{i}", 30 - i, i) for i in range(1, 13)] + [_kis_row("069500", "KODEX 200", 29.5, 0)]
DOWN = [_kis_row(f"{100 + i:06d}", f"하락{i}", -(30 - i), i) for i in range(1, 13)]
UNIVERSE = {r["stck_shrn_iscd"] for r in UP + DOWN} - {"069500"}
NOW = datetime(2026, 10, 30, 10, 0, tzinfo=KST)


def _reasons(prompt):
    # 20종목 중 하나(000001)는 일부러 빼고, 하나는 'A' 접두어로 돌려준다
    items = []
    for t in [f"{i:06d}" for i in range(2, 11)] + [f"{100 + i:06d}" for i in range(1, 11)]:
        items.append({"ticker": t, "stock_name": "x", "change_rate": 1.0, "reason_summary": f"{t} 원인",
                      "category": "테마수급", "reliability": "중"})
    items[0]["ticker"] = "A" + items[0]["ticker"]
    return MoverReasonsResponse(items=items)


def test_fetch_movers_filters_universe_and_direction():
    kis = FakeKis(UP, DOWN + [_kis_row("000999", "보합", 0.0, 13)])
    g, l = mm.fetch_movers(kis, universe=UNIVERSE | {"000999"})
    assert len(g) == 10 and len(l) == 10
    assert "069500" not in {r["ticker"] for r in g}  # ETF 제외
    assert all(r["change_rate"] > 0 for r in g) and all(r["change_rate"] < 0 for r in l)


def test_movers_one_gemini_call_and_ticker_match(monkeypatch, _isolate):
    g = FakeGemini({MoverReasonsResponse: _reasons})
    news = FakeNews()
    monkeypatch.setattr(mm, "_gemini", lambda: g)
    monkeypatch.setattr(mm, "_news", lambda: news)
    monkeypatch.setattr(mm, "_universe", lambda: UNIVERSE)
    out = mm.analyze(NOW, kis_client=FakeKis(UP, DOWN))
    assert len(g.calls) == 1
    assert len(news.queries) == 20 and news.queries[0] == ("상승1 특징주", 5, "date")
    by = {m["ticker"]: m for m in out["gainers"] + out["losers"]}
    assert by["000001"]["reason_summary"] is None  # 응답에서 빠진 종목
    assert by["000002"]["reason_summary"] == "000002 원인"  # 'A000002' 도 매칭
    assert by["000101"]["category"] == "테마수급"
    assert out["updated_at"] == "2026-10-30T10:00:00+09:00" and out["keywords"] == []
    assert cache.get_json(cache.MOVERS_KEY)["gainers"][0]["stock_name"] == "상승1"


def test_movers_no_key_caches_reasonless_list(monkeypatch):
    monkeypatch.setattr(mm, "_universe", lambda: UNIVERSE)
    out = mm.analyze(NOW, kis_client=FakeKis(UP, DOWN))
    assert len(out["gainers"]) == 10 and all(m["reason_summary"] is None for m in out["gainers"])
    assert cache.get_json(cache.MOVERS_KEY)["losers"][0]["ticker"] == "000101"
    assert mm.hot_keywords(out) == []
    assert cache.get_json(cache.KEYWORDS_KEY) is None  # 키 없을 때 빈 값을 캐시하지 않는다


def test_movers_cache_hit_skips_kis_and_gemini(monkeypatch):
    g = FakeGemini({MoverReasonsResponse: _reasons})
    monkeypatch.setattr(mm, "_gemini", lambda: g)
    cache.put_json(cache.MOVERS_KEY, {"updated_at": "t", "gainers": [], "losers": []}, 60)
    kis = FakeKis(UP, DOWN)
    assert mm.analyze(NOW, kis_client=kis)["updated_at"] == "t"
    assert kis.calls == 0 and g.calls == []


def test_movers_kis_error_keeps_previous_cache(monkeypatch):
    monkeypatch.setattr(mm, "_universe", lambda: UNIVERSE)
    cache.put_json(cache.MOVERS_KEY, {"updated_at": "이전", "gainers": [], "losers": []}, 60)
    out = mm.analyze(NOW, kis_client=FakeKis(UP, DOWN, fail=True), force=True)
    assert "skipped" in out
    assert cache.get_json(cache.MOVERS_KEY)["updated_at"] == "이전"


def test_hot_keywords_gemini_and_cache(monkeypatch):
    def kw(_p):
        return HotKeywordsResponse(keywords=[{"keyword": "AI", "background": "b", "tickers": ["1", "999999"]}])

    g = FakeGemini({HotKeywordsResponse: kw})
    monkeypatch.setattr(mm, "_gemini", lambda: g)
    movers = {"gainers": [{"ticker": "000001", "stock_name": "상승1", "change_rate": 29.0}], "losers": []}
    assert mm.hot_keywords(movers) == [{"keyword": "AI", "background": "b", "tickers": ["000001"]}]
    assert mm.hot_keywords(movers)[0]["keyword"] == "AI"
    assert len(g.calls) == 1  # 두 번째는 캐시
    assert mm.get_cached()["keywords"][0]["keyword"] == "AI"


def test_get_cached_empty_shape():
    assert mm.get_cached() == {"updated_at": None, "gainers": [], "losers": [], "keywords": []}


@pytest.mark.parametrize("hh,mm_,expected", [(9, 9, False), (9, 10, True), (15, 30, True), (15, 31, False)])
def test_in_session_window_bounds(hh, mm_, expected):
    assert mm.in_session_window(datetime(2026, 10, 30, hh, mm_, tzinfo=KST)) is expected


def test_in_session_window_last_slot_seconds_late():
    assert mm.in_session_window(datetime(2026, 10, 30, 15, 30, 40, tzinfo=KST)) is True


def test_in_session_window_weekend_and_holiday():
    assert mm.in_session_window(datetime(2026, 10, 31, 10, 0, tzinfo=KST)) is False  # 토요일
    holiday = date(2026, 10, 9)  # 한글날(금)
    assert market_calendar.is_trading_day(holiday) is False
    assert mm.in_session_window(datetime(2026, 10, 9, 10, 0, tzinfo=KST)) is False


def test_in_session_window_converts_utc():
    assert mm.in_session_window(datetime(2026, 10, 30, 1, 10, tzinfo=ZoneInfo("UTC"))) is True  # 10:10 KST


# ---------------------------------------------------------------- 수급 해설
RAW_FLOW = {"date": "2026-10-30", "source": "kis",
            "foreign_top": [{"ticker": "005930", "name": "삼성전자", "net_amount": 1e10}],
            "institution_top": [], "pension_top": [], "double_buy": []}


def test_flow_no_key_caches_without_comment(monkeypatch):
    monkeypatch.setattr(flow, "_collect", lambda day, ch=None, session=None: RAW_FLOW)
    out = flow.build(DAY)
    assert out["ai_comment"] is None and out["source"] == "kis" and out["updated_at"]
    assert flow.get_cached()["foreign_top"][0]["ticker"] == "005930"


def test_flow_comment_and_reuse(monkeypatch):
    g = FakeGemini({InvestorFlowComment: lambda p: InvestorFlowComment(comment="반도체로 쏠림")})
    monkeypatch.setattr(flow, "_gemini", lambda: g)
    monkeypatch.setattr(flow, "_collect", lambda day, ch=None, session=None: RAW_FLOW)
    monkeypatch.setattr(flow, "_sector_map", lambda session=None: {"005930": "반도체"})
    assert flow.build(DAY)["ai_comment"] == "반도체로 쏠림"
    assert "삼성전자(005930) · 반도체" in g.calls[0][1]
    assert flow.build(DAY)["ai_comment"] == "반도체로 쏠림"
    assert len(g.calls) == 1  # 같은 기준일·출처 해설은 재사용
    flow.build(DAY, force=True)
    assert len(g.calls) == 2


def test_flow_collect_none_keeps_cache(monkeypatch):
    cache.put_json(cache.INVESTOR_FLOW_KEY, {**RAW_FLOW, "ai_comment": "이전"}, 60)
    monkeypatch.setattr(flow, "_collect", lambda day, ch=None, session=None: None)
    assert flow.build(DAY) is None
    assert flow.get_cached()["ai_comment"] == "이전"


def test_flow_pg_error_returns_none(monkeypatch):
    def raise_pg(day, ch=None, session=None):
        raise RuntimeError("PG 연결 실패")

    monkeypatch.setattr(flow, "_collect", raise_pg)
    assert flow.build(DAY) is None
    assert flow.get_cached() == {"date": None, "source": None, "foreign_top": [], "institution_top": [],
                                 "pension_top": [], "double_buy": [], "ai_comment": None, "updated_at": None}


# ---------------------------------------------------------------- 정성 평가
def _qual(level="CLEAN"):
    def h(_p):
        return ScreenerQualitativeResponse(ticker="WRONG", hook_summary="포착" * 200, growth_quality="본업성장",
                                           financial_quality_note="n", red_flag_level=level, red_flags=[])
    return h


SCREEN = {"date": "2026-10-29", "total": 3, "items": [
    {"ticker": t, "name": f"종목{t}", "score": 6, "pass_count": 6, "sector_name": "반도체", "rs": 90.0,
     "pct_from_high": -3.0, "letters": {"c": 1, "a": 1, "n": 1, "s": 1, "l": 1, "i": 0, "m": -2}}
    for t in ("000001", "000002", "000003")]}


def test_candidates_from_canslim(monkeypatch):
    monkeypatch.setattr(sq, "_screen", lambda limit: SCREEN)
    c = sq.candidates(DAY, limit=2)
    assert [x["ticker"] for x in c] == ["000001", "000002"]
    assert c[0]["summary"]["I(기관·외국인)"] == "미통과" and c[0]["summary"]["M(시장 방향)"] == "대기"
    assert c[0]["summary"]["기준일"] == "2026-10-29"


def test_candidates_screen_error_empty(monkeypatch):
    monkeypatch.setattr(sq, "_screen", _boom)
    assert sq.candidates(DAY) == []


def test_evaluate_no_key_none(session):
    assert sq.evaluate(DAY, "000001", "종목", {}, session=session) is None


def test_evaluate_dart_hint_raises_clean_to_warning(session):
    g = FakeGemini({ScreenerQualitativeResponse: _qual("CLEAN")})
    got = sq.evaluate(DAY, "000001", "종목", {"점수": 6}, session=session, dart=FakeDart(["전환사채권발행결정"]),
                      news=FakeNews(), gemini=g)
    assert got["red_flag_level"] == "WARNING" and got["ticker"] == "000001"
    assert any("전환사채" in f for f in got["red_flags"]) and len(got["hook_summary"]) == 255
    assert repo.get_latest_evaluation(session, "000001")["red_flag_level"] == "WARNING"


def test_evaluate_no_hint_keeps_clean_and_danger_stays(session):
    g = FakeGemini({ScreenerQualitativeResponse: _qual("CLEAN")})
    assert sq.evaluate(DAY, "000001", "종목", {}, session=session, dart=FakeDart([]), news=None,
                       gemini=g)["red_flag_level"] == "CLEAN"
    g2 = FakeGemini({ScreenerQualitativeResponse: _qual("DANGER")})
    assert sq.evaluate(DAY, "000002", "종목", {}, session=session, dart=FakeDart(["유상증자결정"]), news=None,
                       gemini=g2)["red_flag_level"] == "DANGER"


def test_evaluate_batch_skips_done_and_isolates_failure(session, monkeypatch):
    calls = {"n": 0}

    def handler(prompt):
        calls["n"] += 1
        if "000003" in prompt:
            raise RuntimeError("한 종목 실패")
        return _qual()(prompt)

    g = FakeGemini({ScreenerQualitativeResponse: handler})
    monkeypatch.setattr(sq, "_gemini", lambda: g)
    monkeypatch.setattr(sq, "_screen", lambda limit: SCREEN)
    repo.upsert_evaluation(session, DAY, _qual()(None).model_copy(update={"ticker": "000001"}))
    out = sq.evaluate_batch(DAY, session=session)
    assert out == {"ok": 1, "skipped": 1, "failed": ["000003"]}
    assert calls["n"] == 2  # 000001 은 이미 평가돼 Gemini 미호출
    assert repo.evaluated_tickers(session, DAY) == {"000001", "000002"}
    assert sq.get_latest("000002", session=session)["ticker"] == "000002"


def test_evaluate_batch_no_key_skips_everything(session):
    assert sq.evaluate_batch(DAY, session=session) == {"skipped": "no_gemini_key"}  # _screen(_boom) 도 안 부름

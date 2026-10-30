"""AI 시황 Celery 태스크 — 휴장일·장외·잠금 skipped, force=True 호출, 예외 → error, beat·include 등록, last 캐시.

실제 외부 호출 0회: KIS 클라이언트 생성·서비스·PG 세션을 모두 가짜로 바꿔 끼운다.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import fakeredis
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from apps.ai_analyst import cache
from apps.ai_analyst import tasks
from apps.ai_analyst.schemas import HotKeywordsResponse
from apps.ai_analyst.services import investor_flow_ai, market_movers, morning_brief, stock_qualitative
from apps.collector.celery_app import celery_app

_REAL_ANALYZE = market_movers.analyze  # autouse 픽스처가 _boom 으로 바꾸기 전 원본
_REAL_HOT_KEYWORDS = market_movers.hot_keywords
KST = ZoneInfo("Asia/Seoul")
FRI_1000 = datetime(2026, 10, 30, 10, 0, tzinfo=KST)  # 금요일 거래일
SAT_1000 = datetime(2026, 10, 31, 10, 0, tzinfo=KST)


def _boom(*a, **k):
    raise AssertionError("실제 외부 호출 시도")


class FakeKis:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for k in ("GEMINI_API_KEY", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET", "OPENDART_API_KEY",
              "KRX_ID", "KRX_PW", "TRADING_DAYS", "MARKET_HOLIDAYS"):
        monkeypatch.delenv(k, raising=False)
    fake = fakeredis.FakeRedis(decode_responses=True)  # 운영과 같이 str 반환(잠금 토큰 비교)
    monkeypatch.setattr(cache, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(tasks, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(tasks, "_now", lambda: FRI_1000)
    monkeypatch.setattr(tasks, "_kis_client", _boom)
    engine = create_engine("sqlite://")
    monkeypatch.setattr(tasks, "SyncSessionLocal", sessionmaker(engine))
    for fn in (("generate", morning_brief), ("analyze", market_movers), ("hot_keywords", market_movers),
               ("build", investor_flow_ai), ("evaluate_batch", stock_qualitative)):
        monkeypatch.setattr(fn[1], fn[0], _boom)
    return fake


def _at(monkeypatch, now):
    monkeypatch.setattr(tasks, "_now", lambda: now)


# ---------------------------------------------------------------- 등록
def test_include_and_beat_schedule():
    assert "apps.ai_analyst.tasks" in celery_app.conf.include
    beat = celery_app.conf.beat_schedule
    ai = {k: v for k, v in beat.items() if v["task"].startswith("ai.")}
    assert len(ai) == 6
    assert {v["task"] for v in ai.values()} == {"ai.generate_morning_briefing", "ai.analyze_market_movers",
                                                 "ai.collect_investor_flow", "ai.evaluate_screener_stocks"}
    brief = beat["ai-morning-briefing"]["schedule"]
    assert brief.hour == {8} and brief.minute == {30} and brief.day_of_week == {1, 2, 3, 4, 5}
    movers = beat["ai-market-movers"]["schedule"]
    assert movers.minute == set(range(0, 60, 10)) and movers.hour == set(range(9, 16))
    assert movers.day_of_week == {1, 2, 3, 4, 5}
    flows = sorted((min(v["schedule"].hour), min(v["schedule"].minute)) for v in ai.values()
                   if v["task"] == "ai.collect_investor_flow")
    assert flows == [(15, 45), (18, 10), (22, 0)]
    ev = beat["ai-screener-evaluation"]["schedule"]
    assert ev.hour == {16} and ev.minute == {0}
    for name in ("ai.generate_morning_briefing", "ai.analyze_market_movers", "ai.collect_investor_flow",
                 "ai.evaluate_screener_stocks"):
        assert name in celery_app.tasks


# ---------------------------------------------------------------- 휴장일
@pytest.mark.parametrize("task", [tasks.generate_morning_briefing, tasks.collect_investor_flow,
                                  tasks.evaluate_screener_stocks])
def test_weekend_skipped(monkeypatch, task):
    _at(monkeypatch, SAT_1000)
    assert task() == {"skipped": "holiday"}


def test_manual_holiday_skipped(monkeypatch):
    monkeypatch.setenv("MARKET_HOLIDAYS", "2026-10-30")
    assert tasks.generate_morning_briefing() == {"skipped": "holiday"}


# ---------------------------------------------------------------- 모닝 브리핑
def test_morning_briefing_calls_generate_with_kst_today(monkeypatch):
    seen = {}

    def gen(day, *, session, force=False):
        seen["day"] = day
        return {"date": day.isoformat(), "headline": "H"}

    monkeypatch.setattr(morning_brief, "generate", gen)
    assert tasks.generate_morning_briefing() == {"date": "2026-10-30", "headline": "H"}
    assert seen["day"].isoformat() == "2026-10-30"


def test_morning_briefing_no_key(monkeypatch):
    monkeypatch.setattr(morning_brief, "generate", lambda day, *, session, force=False: None)
    assert tasks.generate_morning_briefing() == {"skipped": "no_briefing"}


def test_morning_briefing_error(monkeypatch):
    def fail(day, *, session, force=False):
        raise RuntimeError("터짐")

    monkeypatch.setattr(morning_brief, "generate", fail)
    out = tasks.generate_morning_briefing()
    assert out["error"].startswith("RuntimeError")


# ---------------------------------------------------------------- 급등락
@pytest.mark.parametrize("now", [datetime(2026, 10, 30, 9, 0, tzinfo=KST), datetime(2026, 10, 30, 15, 40, tzinfo=KST),
                                 datetime(2026, 10, 30, 15, 50, tzinfo=KST), SAT_1000])
def test_movers_outside_session(monkeypatch, env, now):
    _at(monkeypatch, now)
    assert tasks.analyze_market_movers() == {"skipped": "outside_session"}
    assert env.get(tasks.MOVERS_LOCK_KEY) is None


def test_movers_locked(monkeypatch, env):
    env.set(tasks.MOVERS_LOCK_KEY, "남의토큰", ex=100)
    assert tasks.analyze_market_movers() == {"skipped": "locked"}
    assert env.get(tasks.MOVERS_LOCK_KEY) == "남의토큰"  # 남의 잠금은 지우지 않는다


def test_movers_force_and_keywords(monkeypatch, env):
    kis = FakeKis()
    monkeypatch.setattr(tasks, "_kis_client", lambda: kis)
    calls = {}
    result = {"updated_at": "2026-10-30T10:00:00+09:00", "gainers": [{"ticker": "005930"}], "losers": [],
              "keywords": []}

    def analyze(now, *, kis_client, session=None, force=False):
        calls["analyze"] = (now, kis_client, force)
        assert env.get(tasks.MOVERS_LOCK_KEY)  # 잠근 상태에서 실행
        return result

    def hot(movers, *, force=False):
        calls["hot"] = (movers, force)
        return [{"keyword": "HBM"}]

    monkeypatch.setattr(market_movers, "analyze", analyze)
    monkeypatch.setattr(market_movers, "hot_keywords", hot)
    out = tasks.analyze_market_movers()
    assert out == {"updated_at": result["updated_at"], "gainers": 1, "losers": 0, "keywords": 1}
    assert calls["analyze"] == (FRI_1000, kis, True)
    assert calls["hot"] == (result, False)
    assert kis.closed
    assert env.get(tasks.MOVERS_LOCK_KEY) is None  # 끝나면 해제


def test_movers_skipped_result_no_keywords(monkeypatch, env):
    kis = FakeKis()
    monkeypatch.setattr(tasks, "_kis_client", lambda: kis)
    monkeypatch.setattr(market_movers, "analyze", lambda now, *, kis_client, session=None, force=False:
                        {"skipped": "kis_error"})
    assert tasks.analyze_market_movers() == {"skipped": "kis_error"}  # hot_keywords 는 _boom — 불리지 않음
    assert kis.closed and env.get(tasks.MOVERS_LOCK_KEY) is None


def test_movers_error_releases_lock(monkeypatch, env):
    kis = FakeKis()
    monkeypatch.setattr(tasks, "_kis_client", lambda: kis)

    def fail(now, *, kis_client, session=None, force=False):
        raise RuntimeError("터짐")

    monkeypatch.setattr(market_movers, "analyze", fail)
    out = tasks.analyze_market_movers()
    assert out["error"].startswith("RuntimeError")
    assert kis.closed and env.get(tasks.MOVERS_LOCK_KEY) is None


# ---------------------------------------------------------------- 수급
def test_investor_flow_no_data(monkeypatch):
    seen = {}

    def build(day, *, ch=None, session=None, force=False):
        seen["force"] = force
        return None

    monkeypatch.setattr(investor_flow_ai, "build", build)
    assert tasks.collect_investor_flow() == {"skipped": "no_data"}
    assert seen["force"] is False


def test_investor_flow_ok(monkeypatch):
    monkeypatch.setattr(investor_flow_ai, "build", lambda day, *, ch=None, session=None, force=False:
                        {"date": "2026-10-30", "source": "kis", "ai_comment": None})
    assert tasks.collect_investor_flow() == {"date": "2026-10-30", "source": "kis", "ai_comment": False}


def test_investor_flow_error(monkeypatch):
    def fail(*a, **k):
        raise ValueError("x")

    monkeypatch.setattr(investor_flow_ai, "build", fail)
    assert tasks.collect_investor_flow()["error"].startswith("ValueError")


# ---------------------------------------------------------------- 정성 평가
def test_evaluate_screener_passes_result(monkeypatch):
    monkeypatch.setattr(stock_qualitative, "evaluate_batch", lambda day, *, session, limit=30:
                        {"skipped": "no_gemini_key"})
    assert tasks.evaluate_screener_stocks() == {"skipped": "no_gemini_key"}


def test_evaluate_screener_error(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(stock_qualitative, "evaluate_batch", fail)
    assert tasks.evaluate_screener_stocks()["error"].startswith("RuntimeError")


# ---------------------------------------------------------------- 서비스: last 캐시 저장·폴백
class _Gemini:
    def generate_json(self, prompt, schema, *, system=None):
        if schema is HotKeywordsResponse:
            return HotKeywordsResponse(keywords=[{"keyword": "HBM", "background": "b", "tickers": ["005930"]}])
        return None


def test_analyze_and_keywords_write_last(monkeypatch, env):
    # 이 테스트만 진짜 analyze/hot_keywords 를 쓴다(외부 의존 _fetch·_gemini·_news·_universe 는 가짜)
    real = market_movers
    monkeypatch.setattr(real, "analyze", _REAL_ANALYZE)
    monkeypatch.setattr(real, "hot_keywords", _REAL_HOT_KEYWORDS)
    monkeypatch.setattr(real, "_fetch", lambda client, desc: [
        {"ticker": "005930", "name": "삼성전자", "price": 1.0, "change_rate": 5.0 if desc else -5.0}])
    monkeypatch.setattr(real, "_gemini", lambda: None)
    monkeypatch.setattr(real, "_news", lambda: None)
    monkeypatch.setattr(real, "_universe", lambda: {"005930"})
    body = real.analyze(FRI_1000, kis_client=object(), force=True)
    assert cache.get_json(cache.MOVERS_LAST_KEY)["updated_at"] == body["updated_at"]
    assert env.ttl(cache.MOVERS_LAST_KEY) > cache.MOVERS_TTL

    monkeypatch.setattr(real, "_gemini", lambda: _Gemini())
    kws = real.hot_keywords(body)
    assert kws == [{"keyword": "HBM", "background": "b", "tickers": ["005930"]}]
    assert cache.get_json(cache.KEYWORDS_LAST_KEY) == kws

    # today 만료 → last 로 폴백
    env.delete(cache.MOVERS_KEY, cache.KEYWORDS_KEY)
    got = real.get_cached()
    assert got["updated_at"] == body["updated_at"] and got["gainers"][0]["ticker"] == "005930"
    assert got["keywords"] == kws

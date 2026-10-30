"""AI 시황 PG 모델·저장소(sqlite) + Redis 캐시(fakeredis) + 마이그레이션 메타."""
import importlib.util
from datetime import date
from pathlib import Path

import fakeredis
import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from apps.ai_analyst import cache
from apps.ai_analyst import repository as repo
from apps.ai_analyst.schemas import MorningBriefingResponse, ScreenerQualitativeResponse
from shared.ai_models import AiDailyBriefing, AiStockEvaluation


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    AiDailyBriefing.__table__.create(engine)
    AiStockEvaluation.__table__.create(engine)
    with Session(engine) as s:
        yield s


def _brief(headline="h"):
    return MorningBriefingResponse(headline=headline, us_market_summary="u", kr_impact_summary="k",
                                   bullish_sectors=[{"sector": "반도체", "reason": "r"}], bearish_sectors=[],
                                   macro_checkpoints=["CPI"])


def _eval(ticker="005930", level="CLEAN"):
    return ScreenerQualitativeResponse(ticker=ticker, hook_summary="포착", growth_quality="본업성장",
                                       financial_quality_note="n", red_flag_level=level, red_flags=["CB"])


def test_upsert_briefing_twice_keeps_one_row(session):
    d = date(2026, 10, 30)
    repo.upsert_briefing(session, d, _brief("첫번째"))
    repo.upsert_briefing(session, d, _brief("두번째"))
    assert session.scalar(select(func.count()).select_from(AiDailyBriefing)) == 1
    got = repo.get_briefing(session, d)
    assert got["headline"] == "두번째" and got["date"] == "2026-10-30"
    assert got["bullish_sectors"] == [{"sector": "반도체", "reason": "r"}]
    assert isinstance(got["created_at"], str)


def test_get_briefing_falls_back_to_latest_before(session):
    repo.upsert_briefing(session, date(2026, 10, 27), _brief("27"))
    repo.upsert_briefing(session, date(2026, 10, 28), _brief("28"))
    repo.upsert_briefing(session, date(2026, 11, 2), _brief("미래"))
    assert repo.get_briefing(session, date(2026, 10, 30))["headline"] == "28"
    assert repo.get_briefing(session, date(2026, 10, 1)) is None


def test_evaluation_upsert_latest_and_tickers(session):
    d1, d2 = date(2026, 10, 29), date(2026, 10, 30)
    repo.upsert_evaluation(session, d1, _eval())
    repo.upsert_evaluation(session, d2, _eval(level="CLEAN"))
    repo.upsert_evaluation(session, d2, _eval(level="DANGER"))
    repo.upsert_evaluation(session, d2, _eval(ticker="000660"))
    assert session.scalar(select(func.count()).select_from(AiStockEvaluation)) == 3
    latest = repo.get_latest_evaluation(session, "005930")
    assert latest["date"] == "2026-10-30" and latest["red_flag_level"] == "DANGER" and latest["red_flags"] == ["CB"]
    assert repo.get_latest_evaluation(session, "999999") is None
    assert repo.evaluated_tickers(session, d2) == {"005930", "000660"}
    assert repo.evaluated_tickers(session, d1) == {"005930"}


def test_table_constraint_and_index_names():
    eval_names = {c.name for c in AiStockEvaluation.__table__.constraints}
    assert "uq_ai_stock_eval_ticker_date" in eval_names
    assert {i.name for i in AiStockEvaluation.__table__.indexes} == {"idx_ai_stock_eval_date"}
    assert {i.name for i in AiDailyBriefing.__table__.indexes} == {"idx_ai_daily_briefings_date"}


def test_migration_revision():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "8e2b4c6d1f30_ai_analyst_tables.py"
    spec = importlib.util.spec_from_file_location("mig_ai_analyst_tables", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.revision == "8e2b4c6d1f30" and mod.down_revision == "5c1e9a7d3b20"


# --- Redis 캐시 --------------------------------------------------------------- #
def test_cache_roundtrip_with_ttl():
    r = fakeredis.FakeRedis(decode_responses=True)
    assert cache.put_json(cache.MOVERS_KEY, {"gainers": [{"name": "알파"}]}, cache.MOVERS_TTL, client=r)
    assert cache.get_json(cache.MOVERS_KEY, client=r) == {"gainers": [{"name": "알파"}]}
    assert 0 < r.ttl(cache.MOVERS_KEY) <= 600
    assert "알파" in r.get(cache.MOVERS_KEY)  # ensure_ascii=False
    assert cache.get_json("없는키", client=r) is None


def test_cache_key_constants():
    assert (cache.MOVERS_KEY, cache.MOVERS_TTL) == ("ai:market:movers:today", 600)
    assert (cache.KEYWORDS_KEY, cache.KEYWORDS_TTL) == ("ai:market:keywords:today", 1800)
    assert (cache.INVESTOR_FLOW_KEY, cache.INVESTOR_FLOW_TTL) == ("market:investor_flow:today", 26 * 3600)


class _BrokenRedis:
    def get(self, *a, **k):
        raise ConnectionError("down")

    def set(self, *a, **k):
        raise ConnectionError("down")


def test_cache_failure_is_swallowed():
    assert cache.put_json("k", {"a": 1}, 10, client=_BrokenRedis()) is False
    assert cache.get_json("k", client=_BrokenRedis()) is None


def test_cache_broken_json_returns_none():
    r = fakeredis.FakeRedis(decode_responses=True)
    r.set("k", "{깨짐")
    assert cache.get_json("k", client=r) is None


def test_cache_uses_singleton_when_no_client(monkeypatch):
    r = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(cache, "get_sync_redis", lambda: r)
    cache.put_json("k", [1, 2], 10)
    assert cache.get_json("k") == [1, 2]

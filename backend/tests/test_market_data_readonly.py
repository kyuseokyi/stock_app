"""MARKET_DATA_SOURCE=prod_readonly 동작 — beat 필터, 쓰기 태스크 early-return, 관리자 작업 거절,
개발 경량 파이프라인, FRED 로컬 쓰기, 차트 시드 폴백 끄기. env 가 없으면 지금과 같아야 한다.

설계: docs/superpowers/specs/2026-11-18-dev-reads-prod-clickhouse-design.md
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import fakeredis
import httpx
import pytest

from apps.collector import celery_app as ca
from apps.collector.tasks import (backfill, bootstrap, canslim, market_data as md, ohlcv, patterns, screener,
                                  universe)
from apps.stock_api.services import admin_jobs as aj


@pytest.fixture
def readonly(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_SOURCE", "prod_readonly")


@pytest.fixture
def local_default(monkeypatch):
    monkeypatch.delenv("MARKET_DATA_SOURCE", raising=False)
    monkeypatch.delenv("CLICKHOUSE_LOCAL_HOST", raising=False)


# ---------------------------------------------------------------- beat
def test_beat_unchanged_without_env(local_default):
    # 모듈 import 시점 beat 는 env 없음(테스트 환경) → 원본 그대로, 경량 파이프라인 없음
    sched = ca.celery_app.conf.beat_schedule
    assert ca.DEV_PIPELINE_BEAT not in sched
    assert ca.READONLY_DISABLED_BEATS <= set(sched)  # 빼는 이름이 실제 beat 이름과 맞는지(오타 방지)


def test_readonly_beat_filters_and_adds_pipeline(monkeypatch):
    monkeypatch.delenv("DEV_PIPELINE_HOUR", raising=False)
    monkeypatch.delenv("DEV_PIPELINE_MINUTE", raising=False)
    base = dict(ca.celery_app.conf.beat_schedule)
    out = ca.readonly_beat_schedule(base)
    assert base == ca.celery_app.conf.beat_schedule  # 원본을 바꾸지 않는다
    assert not (set(out) & ca.READONLY_DISABLED_BEATS)
    assert set(out) == (set(base) - ca.READONLY_DISABLED_BEATS) | {ca.DEV_PIPELINE_BEAT}
    for name in set(base) - ca.READONLY_DISABLED_BEATS:  # 남는 beat 는 그대로(장중 지수·AI·FRED·게임 등)
        assert out[name] is base[name]
    for kept in ("poll-intraday-indices", "collect-macro-series", "settle-trading-season", "ai-morning-briefing"):
        assert kept in out
    entry = out[ca.DEV_PIPELINE_BEAT]
    assert entry["task"] == "collector.dev_readonly_pipeline"
    assert entry["schedule"].hour == {23} and entry["schedule"].minute == {30}


def test_readonly_beat_time_from_env(monkeypatch):
    monkeypatch.setenv("DEV_PIPELINE_HOUR", "22")
    monkeypatch.setenv("DEV_PIPELINE_MINUTE", "45")
    s = ca.readonly_beat_schedule({})[ca.DEV_PIPELINE_BEAT]["schedule"]
    assert s.hour == {22} and s.minute == {45}


def test_dev_pipeline_task_registered():
    assert "collector.dev_readonly_pipeline" in ca.celery_app.tasks


# ---------------------------------------------------------------- 쓰기 태스크 early-return
def _boom(*a, **k):
    raise AssertionError("prod_readonly 인데 KIS·CH·PG 를 건드림")


WRITE_TASKS = [
    (universe, "collect_all_daily", {}), (universe, "backfill_all_daily", {}),
    (backfill, "backfill_domestic_daily", {"ticker": "005930"}), (ohlcv, "collect_daily_ohlcv", {"ticker": "005930"}),
    (md, "collect_market_indices", {}), (md, "collect_investor_daily", {}), (md, "collect_investor_detail_daily", {}),
    (md, "backfill_investor_detail", {}), (md, "collect_lending_daily", {}), (md, "backfill_lending", {}),
    (md, "collect_fundamentals", {}), (md, "daily_market_pipeline", {}),
    (canslim, "compute_canslim", {}), (canslim, "backfill_canslim", {}),
    (screener, "compute_screener", {}), (screener, "backfill_screener", {}),
    (patterns, "compute_patterns", {}), (bootstrap, "bootstrap_data", {}),
]


@pytest.fixture
def no_side_effects(monkeypatch):
    for mod, attr in ((universe, "KISClient"), (universe, "_run_universe"), (universe, "_daily_fallback"),
                      (md, "KISClient"), (md, "_kis_client"), (md, "_run_universe"), (md, "_analysis_tickers"),
                      (md.chm, "ensure_market_tables"), (md, "get_sync_redis"), (md, "_daily_ohlcv"),
                      (canslim, "_prepare"), (screener, "_prepare"), (patterns.cp, "ensure_patterns_table"),
                      (bootstrap, "run_bootstrap"), (backfill, "fetch_domestic_daily_range"),
                      (ohlcv, "fetch_domestic_daily")):
        monkeypatch.setattr(mod, attr, _boom)


@pytest.mark.parametrize("mod,name,kwargs", WRITE_TASKS, ids=[n for _, n, _ in WRITE_TASKS])
def test_write_tasks_skip_before_kis(readonly, no_side_effects, mod, name, kwargs):
    task = getattr(mod, name)
    assert task.apply(kwargs=kwargs).get() == {"skipped": "prod_readonly"}


def test_market_groups_and_fred_not_skipped(readonly, monkeypatch):
    # Q1-a: 시장 그룹은 개발이 계속 계산, Q3: FRED 계속 — early-return 대상이 아니다
    from apps.collector.tasks import market_groups as mg

    monkeypatch.setattr(mg, "_prepare", lambda: ([], {}, {}, {}))
    monkeypatch.setattr(mg.cg, "latest_trading_date", lambda: None)
    assert mg.compute_market_groups() == {"skipped": "일봉 없음"}
    monkeypatch.setattr(md.fred, "api_key", lambda: None)
    assert md.collect_macro_series() == {"skipped": "FRED_API_KEY 없음"}


# ---------------------------------------------------------------- FRED 로컬 쓰기
def _fred_fakes(monkeypatch, seen):
    class F:
        def __init__(self, key):
            pass

        def observations(self, sid, start):
            return [(date(2026, 10, 1), 1.0)]

        def release_of(self, sid):
            return None

    monkeypatch.setattr(md.fred, "api_key", lambda: "k")
    monkeypatch.setattr(md.fred, "series_ids", lambda: ["DGS10"])
    monkeypatch.setattr(md.fred, "FredClient", F)
    monkeypatch.setattr(md, "_save_events", lambda ev: 0)
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda **kw: seen.append(("ensure", kw)))
    monkeypatch.setattr(md.chm, "latest_macro_date", lambda s, **kw: seen.append(("latest", kw)))
    monkeypatch.setattr(md.chm, "upsert_macro", lambda s, obs, **kw: seen.append(("upsert", kw)) or len(obs))


def test_fred_without_local_env_passes_no_client(local_default, monkeypatch):
    seen = []
    _fred_fakes(monkeypatch, seen)
    assert md.collect_macro_series(today=date(2026, 11, 18))["inserted"] == 1
    assert [kw for _, kw in seen] == [{}, {}, {}]


def test_fred_with_local_env_writes_local(readonly, monkeypatch):
    seen = []
    local = object()
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    monkeypatch.setattr(md, "get_local_client", lambda: local)
    _fred_fakes(monkeypatch, seen)
    md.collect_macro_series(today=date(2026, 11, 18))
    assert [kw["client"] for _, kw in seen] == [local, local, local]


# ---------------------------------------------------------------- 경량 파이프라인
def test_dev_pipeline_steps_and_record(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    order = []
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(md, "load_domestic_tickers", lambda: order.append("master") or [1, 2])
    monkeypatch.setattr(md, "compute_market_groups", lambda: order.append("groups") or {"error": "x"})
    monkeypatch.setattr(md, "compute_featured_highs", lambda: order.append("featured") or {"highs": 1})
    # 일봉·KIS 를 부르면 안 된다
    for attr in ("collect_all_daily", "_daily_ohlcv", "collect_market_indices", "compute_canslim", "compute_screener",
                 "compute_patterns", "KISClient"):
        monkeypatch.setattr(md, attr, _boom)
    out = md.dev_readonly_pipeline()
    assert order == ["master", "groups", "featured"]
    assert out["master"] == {"active": 2}
    from shared import pipeline_record

    rec = pipeline_record.load(fake)
    assert [(s["name"], s["ok"]) for s in rec["steps"]] == [("master", True), ("market_groups", False),
                                                            ("featured_highs", True)]


def test_dev_pipeline_step_exception_isolated(monkeypatch):
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    monkeypatch.setattr(md, "load_domestic_tickers", _boom)
    monkeypatch.setattr(md, "compute_market_groups", lambda: {"date": "2026-11-18"})
    monkeypatch.setattr(md, "compute_featured_highs", lambda: {})
    out = md.dev_readonly_pipeline()
    assert "error" in out["master"] and out["market_groups"] == {"date": "2026-11-18"}


# ---------------------------------------------------------------- 관리자 작업 거절
KST = timezone(timedelta(hours=9))


@pytest.fixture
def jobs_env(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    sent: list = []
    monkeypatch.setattr(aj, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(aj, "_task_state", lambda tid: ("PENDING", None))
    monkeypatch.setattr(aj, "_now_kst", lambda: datetime(2026, 10, 22, 10, 0, tzinfo=KST))
    monkeypatch.setattr(aj.celery_app, "send_task",
                        lambda name, kwargs=None, task_id=None: sent.append(name))
    return SimpleNamespace(redis=fake, sent=sent)


@pytest.mark.parametrize("key", ["canslim", "backfill_canslim", "screener", "backfill_screener", "patterns",
                                 "bootstrap"])
def test_admin_jobs_rejected_when_readonly(readonly, jobs_env, key):
    with pytest.raises(aj.JobReadonly) as e:
        aj.run(key, "관리자")
    assert "읽기만" in e.value.message
    assert jobs_env.sent == [] and jobs_env.redis.get(aj.LOCK_KEY.format(key)) is None  # 잠금·기록 없음
    assert jobs_env.redis.lrange(aj.HISTORY_KEY, 0, -1) == []


@pytest.mark.parametrize("key", ["market_groups", "backfill_market_groups"])
def test_admin_market_groups_allowed_when_readonly(readonly, jobs_env, key):
    aj.run(key, "관리자")
    assert len(jobs_env.sent) == 1


def test_admin_jobs_allowed_without_env(local_default, jobs_env):
    aj.run("canslim", "관리자")
    assert jobs_env.sent == ["collector.compute_canslim"]


def test_admin_router_readonly_is_409(readonly, jobs_env):
    from apps.stock_api.main import app
    from shared.auth import get_current_user
    from shared.models import User, UserRole

    async def _user():
        return User(id=1, nickname="관리자", role=UserRole.ADMIN, is_active=True)

    async def go():
        app.dependency_overrides[get_current_user] = _user
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
                return await c.post("/api/v1/admin/market/jobs/canslim")
        finally:
            app.dependency_overrides.clear()

    r = asyncio.run(go())
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "JOB_READONLY", "message": aj.READONLY_MESSAGE}


# ---------------------------------------------------------------- 차트 시드 폴백
CHART_Q = """{ getChartData(symbol: "005930", startDate: "2020-01-01", endDate: "2020-03-31") { candles { date } } }"""


@pytest.fixture
def chart(monkeypatch):
    from apps.stock_api.graphql.schema import schema
    from apps.stock_api.seed_catalog import SeedStock
    from apps.stock_api.services import chart as chart_service
    from apps.stock_api.services import clickhouse_source as ch_source

    stock = SeedStock(symbol="005930", name="삼성전자", market="KOSPI", country="KR", currency="KRW")
    monkeypatch.setattr(chart_service, "resolve_stock", lambda _s: stock)
    monkeypatch.setattr(ch_source, "get_candles", lambda *a: None)  # CH 장애·터널 끊김과 같다

    def run():
        res = asyncio.run(schema.execute(CHART_Q))
        assert res.errors is None, res.errors
        return res.data["getChartData"]["candles"]

    return run


def test_chart_readonly_no_fake_seed(readonly, chart):
    assert chart() == []


def test_chart_default_keeps_fake_seed(local_default, chart):
    assert len(chart()) > 0

"""관리자 데이터 현황 — 데이터별 상태 판정(기준 거래일 비교·주기별 기준), 종목 수 감소 경고, 조회 실패 격리, 설정 값 비노출."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import fakeredis
import pytest

from apps.stock_api.services import data_status as ds
from shared import pipeline_record
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)  # 금요일 = 기준 거래일
SECRET = "fred-secret-value"


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다."""

    def __init__(self, routes):
        self.routes = routes

    def query(self, sql, parameters=None):
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "ref": (f"max(date) FROM {DB}.daily_prices", [[D]]),
        "daily": (f"uniqExact(ticker) FROM {DB}.daily_prices", [[D, 2400], [D - timedelta(days=1), 2500]]),
        "index": (f"FROM {DB}.market_index_daily", [["KR:0001", D], ["KR:1001", D], ["US:SPX", D - timedelta(days=1)]]),
        "investor": (f"FROM {DB}.investor_daily", [[D, 2300]]),
        "fund": (f"FROM {DB}.fundamentals_periodic", [[datetime(2026, 10, 10, 10, 30), 2500]]),
        "macro": (f"FROM {DB}.macro_series", [["CPIAUCSL", date(2026, 8, 15)], ["DGS10", D]]),
        "canslim": (f"FROM {DB}.canslim_daily", [[D, 2100]]),
        "groups": (f"FROM {DB}.market_group_daily", [[D, "sector", 40], [D, "theme", 150]]),
    }
    base.update(over)
    return list(base.values())


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(ds, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(ds, "_today", lambda: D)
    monkeypatch.setattr(ds, "index_specs", lambda region: {
        "KR": [SimpleNamespace(code="KR:0001", name="코스피"), SimpleNamespace(code="KR:1001", name="코스닥")],
        "US": [SimpleNamespace(code="US:SPX", name="S&P500")]}[region])
    monkeypatch.setattr(ds.fred, "series_ids", lambda: ["CPIAUCSL", "DGS10"])
    monkeypatch.setattr(ds, "_ipo_stats", lambda today: (datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc), 4))
    monkeypatch.setattr(ds, "get_sync_redis", lambda: fake)
    monkeypatch.setenv("FRED_API_KEY", SECRET)
    monkeypatch.setenv("FUNDAMENTALS_Q_CUMULATIVE", "true")

    def use(**over):
        holder["ch"] = _CH(_routes(**over))

    return SimpleNamespace(use=use, redis=fake)


def _by_key(out):
    return {d["key"]: d for d in out["datasets"]}


def test_all_ok(env):
    pipeline_record.save(env.redis, datetime(2026, 10, 16, 11, 30, tzinfo=timezone.utc),
                         datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc), [{"name": "daily", "ok": True, "seconds": 1.0, "summary": "{}"}])
    out = ds.build_status()
    got = _by_key(out)
    assert out["ref_date"] == "2026-10-16"
    assert list(got) == ["daily", "indices_kr", "indices_us", "investor", "fundamentals", "macro", "ipo",
                         "canslim", "market_groups"]
    assert {k: v["status"] for k, v in got.items()} == {
        "daily": "ok", "indices_kr": "ok", "indices_us": "ok", "investor": "ok", "fundamentals": "ok",
        "macro": "stale", "ipo": "ok", "canslim": "ok", "market_groups": "ok"}  # CPIAUCSL 45일 초과
    assert got["daily"]["count"] == 2400 and got["daily"]["unit"] == "종목"
    assert got["market_groups"]["count"] == 190 and "테마 150" in got["market_groups"]["note"]
    assert [i["status"] for i in got["macro"]["items"]] == ["stale", "ok"]
    assert got["ipo"]["count"] == 4
    assert out["settings"] == {"fred_key": True, "q_cumulative": "true"}
    assert out["pipeline"]["steps"][0]["name"] == "daily"
    assert SECRET not in json.dumps(out, ensure_ascii=False)


def test_stale_warn_and_off(env, monkeypatch):
    env.use(daily=(f"uniqExact(ticker) FROM {DB}.daily_prices", [[D, 2000], [D - timedelta(days=1), 2500]]),
            index=(f"FROM {DB}.market_index_daily", [["KR:0001", D], ["KR:1001", D - timedelta(days=1)],
                                                     ["US:SPX", D - timedelta(days=6)]]),
            investor=(f"FROM {DB}.investor_daily", [[D - timedelta(days=1), 2300]]),
            fund=(f"FROM {DB}.fundamentals_periodic", [[datetime(2026, 10, 3, 10, 30), 2500]]))
    monkeypatch.delenv("FRED_API_KEY")
    monkeypatch.delenv("FUNDAMENTALS_Q_CUMULATIVE")
    monkeypatch.setattr(ds, "_ipo_stats", lambda today: (None, 0))
    out = ds.build_status()
    got = _by_key(out)
    assert got["daily"]["status"] == "warn" and "20%" in got["daily"]["note"]
    assert got["indices_kr"]["status"] == "stale"
    assert [i["status"] for i in got["indices_kr"]["items"]] == ["ok", "stale"]
    assert got["indices_us"]["status"] == "stale"  # 기준일보다 4일 넘게 이전
    assert got["investor"]["status"] == "stale"
    assert got["fundamentals"]["status"] == "stale"
    assert got["macro"]["status"] == "off"
    assert got["ipo"]["status"] == "empty"
    assert out["settings"] == {"fred_key": False, "q_cumulative": "unset"}
    assert out["pipeline"] is None


def test_missing_table_is_empty_not_error(env):
    """아직 한 번도 계산되지 않아 CH 테이블이 없으면 '오류'가 아니라 '없음'(계산 전)."""
    missing = RuntimeError("Code: 60. DB::Exception: Unknown table expression identifier "
                           "'stock.canslim_daily' in scope SELECT ... (UNKNOWN_TABLE)")
    env.use(canslim=(f"FROM {DB}.canslim_daily", missing),
            groups=(f"FROM {DB}.market_group_daily", missing))
    got = _by_key(ds.build_status())
    for key in ("canslim", "market_groups"):
        assert got[key]["status"] == "empty" and "계산" in got[key]["note"]
    assert got["daily"]["status"] == "ok"


def test_ipo_note_does_not_repeat_count(env):
    note = _by_key(ds.build_status())["ipo"]["note"]
    assert "4건" not in note and "60일" in note


def test_query_failure_is_isolated(env):
    env.use(index=(f"FROM {DB}.market_index_daily", RuntimeError("table missing")))
    got = _by_key(ds.build_status())
    assert got["indices_kr"]["status"] == "error" and got["indices_us"]["status"] == "error"
    assert got["daily"]["status"] == "ok" and got["canslim"]["status"] == "ok"


def test_empty_tables(env):
    epoch = date(1970, 1, 1)
    env.use(ref=(f"max(date) FROM {DB}.daily_prices", [[epoch]]),
            daily=(f"uniqExact(ticker) FROM {DB}.daily_prices", []),
            canslim=(f"FROM {DB}.canslim_daily", []),
            groups=(f"FROM {DB}.market_group_daily", []))
    out = ds.build_status()
    got = _by_key(out)
    assert out["ref_date"] is None
    assert got["daily"]["status"] == "empty"
    assert got["canslim"]["status"] == "empty" and got["market_groups"]["status"] == "empty"


def test_ref_query_failure_marks_daily_error(env):
    env.use(ref=(f"max(date) FROM {DB}.daily_prices", RuntimeError("ch down")))
    got = _by_key(ds.build_status())
    assert got["daily"]["status"] == "error"


def test_pipeline_client_failure_is_ignored(env, monkeypatch):
    def boom():
        raise ValueError("bad url")

    monkeypatch.setattr(ds, "get_sync_redis", boom)
    out = ds.build_status()
    assert out["pipeline"] is None
    assert len(out["datasets"]) == 9


def test_market_groups_latest_date_ignores_tombstones(env, monkeypatch):
    seen = []
    orig = ds._query

    def spy(sql, params=None):
        seen.append(sql)
        return orig(sql, params)

    monkeypatch.setattr(ds, "_query", spy)
    ds.build_status()
    sql = next(q for q in seen if "market_group_daily" in q)
    assert "max(date) FROM" in sql and "market_group_daily WHERE members > 0)" in sql

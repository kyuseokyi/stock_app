"""MARKET_DATA_SOURCE 스위치·개발 자체 CH 클라이언트(get_local_client)·타임아웃 env 테스트.

설계: docs/superpowers/specs/2026-11-18-dev-reads-prod-clickhouse-design.md
env 가 없으면 지금과 100% 같아야 한다(get_local_client() is get_client(), 인자 동일, readonly 아님).
"""
from __future__ import annotations

import pytest

import shared.clickhouse_schema as ch

_ENV_KEYS = ("MARKET_DATA_SOURCE", "CLICKHOUSE_LOCAL_HOST", "CLICKHOUSE_LOCAL_PORT", "CLICKHOUSE_LOCAL_USER",
             "CLICKHOUSE_LOCAL_PASSWORD", "CLICKHOUSE_CONNECT_TIMEOUT", "CLICKHOUSE_SEND_RECEIVE_TIMEOUT")


class _Dummy:
    def __init__(self, **kw):
        self.kw = kw


@pytest.fixture
def clean(monkeypatch):
    for k in _ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(ch, "_client", None)
    monkeypatch.setattr(ch, "_client_pid", None)
    monkeypatch.setattr(ch, "_local_client", None)
    monkeypatch.setattr(ch, "_local_client_pid", None)
    calls: list[dict] = []
    monkeypatch.setattr(ch.clickhouse_connect, "get_client", lambda **kw: calls.append(kw) or _Dummy(**kw))
    return calls


def test_no_env_local_is_same_client(clean):
    assert ch.local_client_configured() is False
    assert ch.get_local_client() is ch.get_client()
    assert len(clean) == 1  # 연결은 하나뿐


def test_no_env_client_kwargs_unchanged(clean):
    ch.get_client()
    assert set(clean[0]) == {"host", "port", "username", "password", "autogenerate_session_id"}


def test_local_env_uses_separate_connection(clean, monkeypatch):
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    monkeypatch.setenv("CLICKHOUSE_LOCAL_PORT", "8124")
    monkeypatch.setenv("CLICKHOUSE_LOCAL_USER", "dev_owner")
    monkeypatch.setenv("CLICKHOUSE_LOCAL_PASSWORD", "x")
    main = ch.get_client()
    local = ch.get_local_client()
    assert local is not main
    assert local.kw["host"] == "clickhouse" and local.kw["port"] == 8124
    assert local.kw["username"] == "dev_owner" and local.kw["password"] == "x"
    assert local.kw["autogenerate_session_id"] is False
    assert ch.get_local_client() is local  # 재사용(FD 누수 방지)
    assert len(clean) == 2


def test_local_user_does_not_fall_back_to_main_account(clean, monkeypatch):
    # prod_readonly 에서 CLICKHOUSE_USER 는 상용 읽기 전용 계정 — 로컬 연결에 섞이면 안 된다
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    monkeypatch.setattr(ch, "CLICKHOUSE_USER", "dev_ro")
    assert ch.get_local_client().kw["username"] != "dev_ro"


def test_local_client_new_after_fork(clean, monkeypatch):
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    a = ch.get_local_client()
    monkeypatch.setattr(ch.os, "getpid", lambda: (ch._local_client_pid or 0) + 999)
    assert ch.get_local_client() is not a


def test_timeouts_passed_only_when_set(clean, monkeypatch):
    monkeypatch.setenv("CLICKHOUSE_CONNECT_TIMEOUT", "5")
    monkeypatch.setenv("CLICKHOUSE_SEND_RECEIVE_TIMEOUT", "60")
    ch.get_client()
    assert clean[0]["connect_timeout"] == 5 and clean[0]["send_receive_timeout"] == 60


@pytest.mark.parametrize("value,expected", [(None, False), ("local", False), ("", False),
                                            ("prod_readonly", True), (" PROD_READONLY ", True)])
def test_market_data_readonly(clean, monkeypatch, value, expected):
    if value is not None:
        monkeypatch.setenv("MARKET_DATA_SOURCE", value)
    assert ch.market_data_readonly() is expected
    assert (ch.readonly_skip("t") == {"skipped": "prod_readonly"}) is expected
    if not expected:
        assert ch.readonly_skip("t") is None


def test_ensure_game_minute_bars_uses_local(clean, monkeypatch):
    seen = []

    class C:
        def command(self, sql):
            seen.append(sql)

    monkeypatch.setattr(ch, "get_local_client", lambda: C())
    monkeypatch.setattr(ch, "get_client", lambda: pytest.fail("상용(읽기) 클라이언트로 DDL 을 보내면 안 됨"))
    ch.ensure_game_minute_bars()
    assert "game_minute_bars" in seen[0]


# ---------------------------------------------------------------- 표 단위 라우팅(게임 분봉·시장 그룹)
class _FakeCH:
    def __init__(self, name: str, rows=None):
        self.name = name
        self.rows = rows or []
        self.calls: list[tuple[str, str]] = []

    def query(self, sql, parameters=None):
        self.calls.append(("query", sql))
        return type("R", (), {"result_rows": self.rows})()

    def insert(self, table, rows, column_names=None):
        self.calls.append(("insert", table))

    def command(self, sql):
        self.calls.append(("command", sql))


@pytest.fixture
def two_clients(monkeypatch):
    """상용(읽기) 클라이언트와 로컬 클라이언트를 구분해 어느 쪽으로 갔는지 본다."""
    main, local = _FakeCH("main"), _FakeCH("local")
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    monkeypatch.setattr(ch, "get_client", lambda: main)
    monkeypatch.setattr(ch, "get_local_client", lambda: local)
    return main, local


def test_game_minute_bars_write_and_read_use_local(two_clients, monkeypatch):
    from datetime import date, datetime

    from apps.collector.game_ws import kis_backfill, minute_bars
    from apps.trading_game.services import minute_candles_query as mcq

    main, local = two_clients
    monkeypatch.setattr(mcq, "get_local_client", lambda: local)
    bar = minute_bars.Bar("005930", datetime(2026, 11, 18, 9, 1, tzinfo=minute_bars.KST), 1, 1, 1, 1, 10)
    minute_bars.insert_bars([bar], "tick")
    minute_bars._ensure_table()
    kis_backfill.tick_minutes_in_ch("005930", date(2026, 11, 18))
    kis_backfill.dates_in_ch("005930", date(2026, 11, 1))
    mcq.fetch_candles("005930", "1m")
    mcq.fetch_session_bar("005930")
    assert main.calls == []
    kinds = [k for k, _ in local.calls]
    assert kinds.count("insert") == 1 and kinds.count("command") == 1 and kinds.count("query") == 4


def test_market_groups_repo_reads_bars_from_main_writes_local(two_clients, monkeypatch):
    from datetime import date

    from apps.collector.repositories import clickhouse_market_groups as cg

    main, local = two_clients
    monkeypatch.setattr(cg, "get_client", lambda: main)
    monkeypatch.setattr(cg, "get_local_client", lambda: local)
    d = date(2026, 11, 18)
    cg.load_bars(d)
    cg.ensure_market_group_tables()
    cg.existing_group_ids(d, "theme")
    cg.upsert_stocks([{"date": d, "ticker": "005930"}])
    cg.upsert_groups([{"date": d, "kind": "theme", "group_id": "1"}])
    assert [k for k, s in main.calls] == ["query"] and "daily_prices" in main.calls[0][1]
    assert [k for k, _ in local.calls] == ["command", "command", "query", "insert", "insert"]


@pytest.mark.parametrize("module", ["apps.stock_api.services.market_query", "apps.stock_api.services.theme_metrics",
                                    "apps.stock_api.services.verify_ticker", "apps.stock_api.services.data_status",
                                    "apps.collector.verify.spot_check"])
def test_query_local_routing(monkeypatch, module):
    import importlib

    mod = importlib.import_module(module)
    local = _FakeCH("local", rows=[("x",)])
    monkeypatch.setattr(mod, "get_local_client", lambda: local)
    via_query = []
    monkeypatch.setattr(mod, "_query", lambda sql, params=None: via_query.append(sql) or [("q",)])
    # 설정 없음 → 기존 _query 로 위임(지금 동작)
    monkeypatch.delenv("CLICKHOUSE_LOCAL_HOST", raising=False)
    assert mod._query_local("SELECT 1 FROM market_group_daily") == [("q",)]
    assert via_query and local.calls == []
    # 설정 있음 → 로컬 클라이언트
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    assert mod._query_local("SELECT 1 FROM market_group_daily") == [("x",)]
    assert len(via_query) == 1 and len(local.calls) == 1


def test_market_query_group_sql_goes_local_index_sql_stays_main(monkeypatch):
    from apps.stock_api.services import market_query as mq

    seen = {"local": [], "main": []}
    monkeypatch.setattr(mq, "_query_local", lambda sql, params=None: seen["local"].append(sql) or [])
    monkeypatch.setattr(mq, "_query", lambda sql, params=None: seen["main"].append(sql) or [])
    mq.latest_date()
    mq._streaks("theme", __import__("datetime").date(2026, 11, 18), ["1"])
    assert seen["local"] and all("market_group_daily" in s or "market_stock_daily" in s for s in seen["local"])
    assert not any("market_group_daily" in s or "market_stock_daily" in s for s in seen["main"])

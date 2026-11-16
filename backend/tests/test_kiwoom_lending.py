"""키움 ka20068 대차거래추이(종목별) — 클라이언트 body·연속조회, 정규화, CH DDL·적재, 실행 루프, 태스크·백필.
HTTP·Redis·CH 는 모두 가짜(실제 키움 호출 없음)."""

from __future__ import annotations

from datetime import date, datetime

import fakeredis
import pytest

from apps.collector.kiwoom import client as kc
from apps.collector.kiwoom import lending as kl
from apps.collector.kiwoom.client import KiwoomApiError, KiwoomClient, KiwoomIpError, KiwoomNotConfigured
from apps.collector.kiwoom.normalize import lending_row
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.kis.master import MasterStock
from apps.collector.tasks import market_data as md
from shared.kiwoom_config import KiwoomConfig

CFG = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef", rate_per_sec=4)


# ------------------------------------------------------------------ 가짜 HTTP
class _Resp:
    def __init__(self, body, headers=None):
        self.status_code = 200
        self._body = body
        self.headers = headers or {}

    def json(self):
        return self._body


def _ok(body, headers=None):
    return _Resp({"return_code": 0, "return_msg": "정상적으로 처리되었습니다", **body}, headers)


class _Session:
    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": dict(headers or {})})
        return self.script.pop(0)

    def close(self):
        pass


class _Limiter:
    def acquire(self):
        pass


def _raw(dt, new="1210354", rpy="2693108", irds="-1482754", rmnd="98242435", amt="5452455"):
    # 명세 response_example 의 첫 행과 같은 값(예시 JSON 은 끝 쉼표 때문에 그대로 파싱되지 않아 손으로 옮김)
    return {"dt": dt, "dbrt_trde_cntrcnt": new, "dbrt_trde_rpy": rpy, "dbrt_trde_irds": irds, "rmnd": rmnd,
            "remn_amt": amt}


# ------------------------------------------------------------------ 클라이언트
def test_get_lending_trend_body_path_and_pagination():
    token = _ok({"token": "T", "expires_dt": "20991231235959"})
    p1 = _ok({"dbrt_trde_trnsn": [_raw("20250430"), _raw("20250429")]}, headers={"cont-yn": "Y", "next-key": "NK"})
    p2 = _ok({"dbrt_trde_trnsn": [_raw("20250428")]}, headers={"cont-yn": "N"})
    c = KiwoomClient(CFG, limiter=_Limiter(), session=_Session([token, p1, p2]),
                     redis_client=fakeredis.FakeRedis(decode_responses=True))
    rows = c.get_lending_trend("005930", "20250401", "20250430", max_pages=5)
    assert [r["dt"] for r in rows] == ["20250430", "20250429", "20250428"]
    first, second = c._session.calls[1], c._session.calls[2]
    assert first["url"] == "https://api.kiwoom.com/api/dostk/slb"
    assert first["headers"]["api-id"] == "ka20068"
    # 명세 request_example 과 같은 body — 종목코드는 접미사 없이 6자리
    assert first["json"] == {"strt_dt": "20250401", "end_dt": "20250430", "all_tp": "0", "stk_cd": "005930"}
    assert second["headers"]["cont-yn"] == "Y" and second["headers"]["next-key"] == "NK"


def test_get_lending_trend_default_one_page():
    token = _ok({"token": "T", "expires_dt": "20991231235959"})
    p1 = _ok({"dbrt_trde_trnsn": [_raw("20250430")]}, headers={"cont-yn": "Y", "next-key": "NK"})
    c = KiwoomClient(CFG, limiter=_Limiter(), session=_Session([token, p1]),
                     redis_client=fakeredis.FakeRedis(decode_responses=True))
    assert len(c.get_lending_trend("000660", "20250401", "20250430")) == 1
    assert len(c._session.calls) == 2


# ------------------------------------------------------------------ 정규화
def test_lending_row_units_and_sign():
    r = lending_row(_raw("20250430"))
    assert r == {"date": date(2025, 4, 30), "new_qty": 1210354, "repay_qty": 2693108, "net_qty": -1482754,
                 "balance_qty": 98242435, "balance_amt": 5452455 * 1_000_000}


def test_lending_row_plus_sign_commas_and_blanks():
    r = lending_row({"dt": "20250429", "dbrt_trde_cntrcnt": "+1,000", "dbrt_trde_rpy": "", "dbrt_trde_irds": "+1000",
                     "rmnd": "0000012345", "remn_amt": None})
    assert r["new_qty"] == 1000 and r["repay_qty"] == 0 and r["net_qty"] == 1000
    assert r["balance_qty"] == 12345 and r["balance_amt"] == 0


@pytest.mark.parametrize("dt", ["", None, "2025", "abcdefgh", "20251340"])
def test_lending_row_bad_date_is_none(dt):
    assert lending_row({"dt": dt, "rmnd": "1"}) is None


# ------------------------------------------------------------------ fetch
class _FakeLendingClient:
    def __init__(self, rows=None, errors=None):
        self.rows = rows if rows is not None else {}
        self.errors = errors or {}
        self.calls: list[tuple] = []
        self.closed = False

    def get_lending_trend(self, stk_cd, strt_dt, end_dt, *, max_pages=1):
        self.calls.append((stk_cd, strt_dt, end_dt, max_pages))
        if stk_cd in self.errors:
            raise self.errors[stk_cd]
        return self.rows.get(stk_cd, [])

    def close(self):
        self.closed = True


def test_fetch_lending_clips_dedupes_and_sorts():
    c = _FakeLendingClient({"005930": [_raw("20250501"), _raw("20250430", rmnd="10"), _raw("20250430", rmnd="99"),
                                       _raw("20250428"), {"dt": ""}, _raw("20250331")]})
    rows = kl.fetch_lending(c, "005930", date(2025, 4, 1), date(2025, 4, 30))
    assert [r["date"] for r in rows] == [date(2025, 4, 28), date(2025, 4, 30)]
    assert rows[1]["balance_qty"] == 10  # 같은 날짜는 먼저 받은(최신 쪽) 행
    assert c.calls == [("005930", "20250401", "20250430", kl.MAX_PAGES)]


def test_calendar_start():
    end = date(2026, 11, 16)
    assert kl.calendar_start(end, 5) == date(2026, 11, 5)
    assert kl.calendar_start(end, 60) == date(2026, 8, 20)
    assert kl.calendar_start(end, 0) == kl.calendar_start(end, 1)


# ------------------------------------------------------------------ 실행 루프
S, E = date(2025, 4, 20), date(2025, 4, 30)


def _store_into(saved):
    def store(ticker, rows):
        saved[ticker] = rows
        return len(rows)
    return store


def test_run_lending_collects_each_ticker_and_closes():
    c = _FakeLendingClient({"005930": [_raw("20250430"), _raw("20250429")], "000660": []})
    saved: dict = {}
    out = kl.run_lending(["005930", "000660", "005930"], S, E, client_factory=lambda: c, store=_store_into(saved))
    assert [x[0] for x in c.calls] == ["005930", "000660"]  # 중복 제거
    assert out["total"] == 2 and out["ok"] == 2 and out["inserted"] == 2 and out["failed_count"] == 0
    assert saved["000660"] == []  # 0행은 오류가 아니다
    assert c.closed


def test_run_lending_not_configured_is_skipped():
    def factory():
        raise KiwoomNotConfigured("없음")
    assert kl.run_lending(["005930"], S, E, client_factory=factory, store=_store_into({})) == {"skipped": "키움 키 없음"}


def test_run_lending_ip_error_skips_rest():
    c = _FakeLendingClient({"005930": [_raw("20250430")]}, errors={"000660": KiwoomIpError(8010, "IP")})
    out = kl.run_lending(["005930", "000660", "035420"], S, E, client_factory=lambda: c, store=_store_into({}))
    assert "skipped" in out and "error" not in out
    assert [x[0] for x in c.calls] == ["005930", "000660"]  # 8010 뒤로는 부르지 않음
    assert out["ok"] == 1 and c.closed


def test_run_lending_first_ticker_api_error_stops():
    c = _FakeLendingClient(errors={"005930": KiwoomApiError(1999, "시간 제한")})
    out = kl.run_lending(["005930", "000660"], S, E, client_factory=lambda: c, store=_store_into({}))
    assert "error" in out and "1999" in out["error"]
    assert [x[0] for x in c.calls] == ["005930"]
    assert out["ok"] == 0 and c.closed


def test_run_lending_later_errors_are_isolated():
    c = _FakeLendingClient({"005930": [_raw("20250430")], "035420": [_raw("20250430")]},
                           errors={"000660": KiwoomApiError(1999, "x"), "051910": RuntimeError("boom")})
    out = kl.run_lending(["005930", "000660", "051910", "035420"], S, E, client_factory=lambda: c,
                         store=_store_into({}))
    assert "error" not in out and "skipped" not in out
    assert out["ok"] == 2 and out["failed_count"] == 2
    assert [f["ticker"] for f in out["failed"]] == ["000660", "051910"]


def test_run_lending_empty_targets_does_not_build_client():
    out = kl.run_lending([], S, E, client_factory=lambda: pytest.fail("대상이 없으면 클라이언트를 만들지 않음"),
                         store=_store_into({}))
    assert out["total"] == 0


# ------------------------------------------------------------------ CH
class _FakeCH:
    def __init__(self):
        self.commands, self.inserts = [], []

    def command(self, sql):
        self.commands.append(sql)

    def insert(self, table, rows, column_names):
        self.inserts.append((table, rows, column_names))


def test_lending_ddl():
    ch = _FakeCH()
    chm.ensure_market_tables(ch)
    ddl = next(c for c in ch.commands if ".stock_lending_daily" in c)
    assert "CREATE TABLE IF NOT EXISTS" in ddl and "ENGINE = ReplacingMergeTree(ingested_at)" in ddl
    assert "PARTITION BY toYYYYMM(date)" in ddl and "ORDER BY (ticker, date)" in ddl
    assert "ingested_at  DateTime64(3) DEFAULT now64(3)" in ddl
    for col in ("new_qty", "repay_qty", "net_qty", "balance_qty", "balance_amt"):
        assert f"{col}" in ddl
    assert ddl.count("Int64") == 5


def test_upsert_lending_rows():
    ch = _FakeCH()
    rec = [lending_row(_raw("20250430"))]
    assert chm.upsert_lending_daily("005930", rec, client=ch) == 1
    table, rows, cols = ch.inserts[0]
    assert table.endswith(".stock_lending_daily")
    assert cols == ["ticker", "date", "new_qty", "repay_qty", "net_qty", "balance_qty", "balance_amt"]
    assert rows == [["005930", date(2025, 4, 30), 1210354, 2693108, -1482754, 98242435, 5452455000000]]
    assert chm.upsert_lending_daily("005930", [], client=ch) == 0 and len(ch.inserts) == 1


# ------------------------------------------------------------------ 태스크
def test_task_skipped_without_kiwoom_keys(monkeypatch):
    monkeypatch.setattr(md, "get_kiwoom_config", lambda: KiwoomConfig("", "", 4))
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda: pytest.fail("키 없으면 CH 를 건드리지 않음"))
    monkeypatch.setattr(md, "_analysis_tickers", lambda: pytest.fail("키 없으면 PG 를 건드리지 않음"))
    assert md.collect_lending_daily() == {"skipped": "키움 키 없음"}
    assert md.backfill_lending() == {"skipped": "키움 키 없음"}


@pytest.fixture
def lending_env(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(md, "get_kiwoom_config", lambda: CFG)
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(md, "_analysis_tickers", lambda: [MasterStock("005930", "삼성전자", "KOSPI"),
                                                          MasterStock("000660", "SK하이닉스", "KOSPI")])
    monkeypatch.setattr(md.trading_day, "now_kst", lambda: datetime(2026, 11, 16, 20, 30, tzinfo=md.trading_day.KST))

    def fake_run(tickers, start, end, *, client_factory, store):
        seen.update(tickers=list(tickers), start=start, end=end, store=store)
        return {"total": len(seen["tickers"]), "ok": len(seen["tickers"]), "inserted": 0}

    monkeypatch.setattr(md.kiwoom_lending, "run_lending", fake_run)
    return seen


def test_task_daily_uses_5_trading_days(lending_env):
    out = md.collect_lending_daily()
    assert lending_env["tickers"] == ["005930", "000660"]
    assert lending_env["end"] == date(2026, 11, 16)
    assert lending_env["start"] == kl.calendar_start(date(2026, 11, 16), md.LENDING_DAILY_DAYS)
    assert lending_env["store"] is md.chm.upsert_lending_daily
    assert out["days"] == 5 and out["ok"] == 2


def test_task_backfill_60_days_end_and_limit(lending_env):
    out = md.backfill_lending(end="20261113", limit=1)
    assert lending_env["tickers"] == ["005930"]
    assert lending_env["end"] == date(2026, 11, 13)
    assert lending_env["start"] == kl.calendar_start(date(2026, 11, 13), 60)
    assert out["days"] == 60


def test_task_skipped_result_passes_through(lending_env, monkeypatch):
    monkeypatch.setattr(md.kiwoom_lending, "run_lending", lambda *a, **k: {"skipped": "키움 호출 불가: 8010"})
    assert md.collect_lending_daily() == {"skipped": "키움 호출 불가: 8010"}


def test_kiwoom_client_factory_uses_config(monkeypatch):
    built = {}

    class FakeKC:
        def __init__(self, cfg):
            built["cfg"] = cfg

    monkeypatch.setattr(kc, "KiwoomClient", FakeKC)
    monkeypatch.setattr(md, "get_kiwoom_config", lambda: CFG)
    md._kiwoom_client()
    assert built["cfg"] is CFG


def test_lending_row_drops_all_zero_unconfirmed_row():
    """키움은 미확정 오늘 날짜를 0 으로 채워 준다 — 저장하지 않는다(그래프 0 낙하·급감 오탐 방지)."""
    from apps.collector.kiwoom.normalize import lending_row
    zero = {"dt": "20261117", "dbrt_trde_cntrcnt": "0", "dbrt_trde_rpy": "0", "dbrt_trde_irds": "0", "rmnd": "0", "remn_amt": "0"}
    assert lending_row(zero) is None
    repaid = {**zero, "dbrt_trde_rpy": "500", "dbrt_trde_irds": "-500"}  # 잔고가 0 이 됐어도 거래가 있으면 유지
    assert lending_row(repaid)["balance_qty"] == 0 and lending_row(repaid)["net_qty"] == -500

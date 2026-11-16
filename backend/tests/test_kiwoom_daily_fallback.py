"""일봉 키움 폴백 — 키움 일봉 조회(연속조회·기간 자르기), 폴백 패스, 켜짐 조건, CH source 컬럼.

키움·KIS·ClickHouse 는 모두 가짜(실제 호출 없음).
"""

from __future__ import annotations

from datetime import date

import pytest

from apps.collector.kiwoom import daily_fallback as dfb
from apps.collector.kiwoom import fetcher as kf
from apps.collector.kiwoom.client import (
    KiwoomApiError,
    KiwoomConnectionError,
    KiwoomIpError,
    KiwoomNotConfigured,
    KiwoomResponse,
)
from apps.collector.repositories import clickhouse_ohlcv as cho
from shared import clickhouse_schema as chs
from shared.kiwoom_config import KiwoomConfig

CFG_ON = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef")
CFG_OFF = KiwoomConfig(app_key="", app_secret="")


def _raw(dt: str, close: int = 100) -> dict:
    return {"dt": dt, "open_pric": f"+{close}", "high_pric": f"+{close + 5}", "low_pric": f"-{close - 5}",
            "cur_prc": f"+{close}", "trde_qty": "1000", "trde_prica": "12"}


class _FakeKiwoom:
    """post 호출마다 pages 를 차례로 돌려준다(cont_yn=다음 페이지 유무)."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.calls: list[dict] = []
        self.closed = False

    def post(self, api_id, path, body, *, cont_key=None):
        self.calls.append({"api_id": api_id, "path": path, "body": dict(body), "cont_key": cont_key})
        rows = self.pages.pop(0)
        more = bool(self.pages)
        return KiwoomResponse(data={"stk_dt_pole_chart_qry": rows}, cont_yn=more,
                              next_key=f"K{len(self.calls)}" if more else "")

    def close(self):
        self.closed = True


# ---------------------------------------------------------------- 키움 일봉 조회
def test_fetch_daily_uses_al_suffix_adjusted_and_base_dt_end():
    c = _FakeKiwoom([[_raw("20261015"), _raw("20261014"), _raw("20260930")]])
    out = kf.fetch_daily_ohlcv("005930", "20261001", "20261015", client=c, today=date(2026, 11, 16))
    assert c.calls[0]["api_id"] == "ka10081"
    assert c.calls[0]["body"] == {"stk_cd": "005930_AL", "base_dt": "20261015", "upd_stkpc_tp": "1"}
    # 기간 밖(9/30) 제외, 오름차순, KIS 일봉과 같은 키(거래대금 없음)
    assert [r["date"] for r in out] == [date(2026, 10, 14), date(2026, 10, 15)]
    assert set(out[0]) == {"date", "open", "high", "low", "close", "volume"}
    assert out[0]["close"] == 100.0 and out[0]["low"] == 95.0 and out[0]["volume"] == 1000


def test_fetch_daily_clamps_future_end_to_today():
    c = _FakeKiwoom([[_raw("20261116")]])
    kf.fetch_daily_ohlcv("005930", "20261017", "20261118", client=c, today=date(2026, 11, 16))
    assert c.calls[0]["body"]["base_dt"] == "20261116"


def test_fetch_daily_paginates_until_older_than_start():
    pages = [[_raw("20261015"), _raw("20261010")], [_raw("20261009"), _raw("20261001")],
             [_raw("20260930")], [_raw("20260901")]]
    c = _FakeKiwoom(pages)
    out = kf.fetch_daily_ohlcv("000660", "20261001", "20261015", client=c, today=date(2026, 11, 16))
    # 2쪽에서 시작일(10/01)에 닿았지만 더 이른 행이 없어 3쪽까지, 3쪽 9/30 < 시작 → 멈춤
    assert len(c.calls) == 3
    assert c.calls[1]["cont_key"] == "K1" and c.calls[2]["cont_key"] == "K2"
    assert [r["date"].day for r in out] == [1, 9, 10, 15]


def test_fetch_daily_respects_page_cap(caplog):
    pages = [[_raw(f"202610{d:02d}")] for d in range(20, 0, -1)]
    c = _FakeKiwoom(pages)
    out = kf.fetch_daily_ohlcv("000660", "20260101", "20261020", client=c, max_pages=3,
                               today=date(2026, 11, 16))
    assert len(c.calls) == 3
    assert [r["date"].day for r in out] == [18, 19, 20]
    assert "상한" in caplog.text


def test_fetch_daily_skips_blank_rows_and_dedupes():
    c = _FakeKiwoom([[_raw("20261015"), {"dt": "", "cur_prc": ""}, {"dt": "20261014", "cur_prc": ""},
                      _raw("20261015", 200), {**_raw("20261013"), "cur_prc": "0"}]])
    out = kf.fetch_daily_ohlcv("000660", "20261001", "20261015", client=c, today=date(2026, 11, 16))
    assert [r["date"].day for r in out] == [15]


def test_fetch_daily_stops_when_no_more_pages():
    c = _FakeKiwoom([[_raw("20261015")]])
    out = kf.fetch_daily_ohlcv("000660", "20200101", "20261015", client=c, today=date(2026, 11, 16))
    assert len(c.calls) == 1 and len(out) == 1


# ---------------------------------------------------------------- 켜짐 조건
@pytest.mark.parametrize("raw,expected", [(None, True), ("", True), ("true", True), ("1", True),
                                          ("false", False), ("FALSE", False), ("0", False), ("off", False),
                                          ("no", False)])
def test_fallback_enabled_env(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("KIWOOM_FALLBACK_ENABLED", raising=False)
    else:
        monkeypatch.setenv("KIWOOM_FALLBACK_ENABLED", raw)
    assert dfb.fallback_enabled(CFG_ON) is expected


def test_fallback_disabled_without_keys(monkeypatch):
    monkeypatch.delenv("KIWOOM_FALLBACK_ENABLED", raising=False)
    assert dfb.fallback_enabled(CFG_OFF) is False


# ---------------------------------------------------------------- 폴백 패스
def _fb(store, client=None, factory=None, ensure=None):
    made = []

    def default_factory():
        c = client or _FakeKiwoom([])
        made.append(c)
        return c

    fb = dfb.DailyFallback(store, client_factory=factory or default_factory,
                           ensure_column=ensure or (lambda: None))
    return fb, made


def _failed(*tickers):
    return [{"ticker": t, "name": t, "error": "x", "retryable": False} for t in tickers]


def test_run_without_targets_does_not_create_client():
    fb, made = _fb(lambda c, t: pytest.fail("호출되면 안 됨"))
    stats = fb.run([])
    assert made == [] and stats == {"recovered": set(), "filled": 0, "failed": 0, "inserted": 0}


def test_run_recovers_failed_and_fills_empty():
    stored = []

    def store(client, ticker):
        stored.append(ticker)
        return {"A": 3, "B": 0, "E": 2}[ticker]

    fb, made = _fb(store)
    fb.note_empty("E")
    stats = fb.run(_failed("A", "B"))
    assert stored == ["A", "B", "E"]
    assert stats["recovered"] == {"A"}          # B 는 키움도 0행 → 여전히 실패
    assert stats["filled"] == 2                  # A(실패 회복) + E(빈 응답 채움)
    assert stats["failed"] == 1                  # B
    assert stats["inserted"] == 5
    assert len(made) == 1 and made[0].closed     # 실행당 클라이언트 1개, 끝나면 닫음


def test_run_kiwoom_error_isolated_and_continues():
    def store(client, ticker):
        if ticker == "A":
            raise KiwoomConnectionError("키움 연결 실패")
        if ticker == "B":
            raise KiwoomApiError(1, "오류")
        return 1

    fb, _ = _fb(store)
    stats = fb.run(_failed("A", "B", "C"))
    assert stats["recovered"] == {"C"} and stats["failed"] == 2


def test_run_ip_error_disables_and_warns_once(caplog):
    calls = []

    def store(client, ticker):
        calls.append(ticker)
        raise KiwoomIpError(8010, "IP 불일치")

    fb, _ = _fb(store)
    stats = fb.run(_failed("A", "B", "C"))
    assert calls == ["A"]                         # 첫 8010 에서 폴백 중단
    assert stats["recovered"] == set() and stats["failed"] == 1
    assert caplog.text.count("키움 폴백을 끕니다") == 1
    assert fb.run(_failed("D")) == {"recovered": set(), "filled": 0, "failed": 0, "inserted": 0}


def test_run_not_configured_on_create_disables_quietly(caplog):
    def factory():
        raise KiwoomNotConfigured("키 없음")

    fb, _ = _fb(lambda c, t: 1, factory=factory)
    stats = fb.run(_failed("A"))
    assert stats["recovered"] == set() and stats["failed"] == 0
    assert caplog.text.count("키움 폴백을 끕니다") == 1


def test_run_ensures_source_column_once_before_store():
    order = []
    fb, _ = _fb(lambda c, t: order.append(t) or 1, ensure=lambda: order.append("ALTER"))
    fb.run(_failed("A", "B"))
    assert order == ["ALTER", "A", "B"]


# ---------------------------------------------------------------- CH source 컬럼
class _FakeCH:
    def __init__(self):
        self.inserts = []
        self.commands = []

    def insert(self, table, rows, column_names=None):
        self.inserts.append((table, rows, list(column_names)))

    def command(self, sql):
        self.commands.append(sql)


REC = [{"date": date(2026, 10, 15), "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10}]


def test_upsert_kis_path_columns_unchanged(monkeypatch):
    ch = _FakeCH()
    monkeypatch.setattr(cho, "get_client", lambda: ch)
    cho.upsert_daily_prices("005930", REC)
    _, rows, cols = ch.inserts[0]
    assert cols == ["ticker", "date", "open", "high", "low", "close", "volume", "ma5", "ma20", "ma50", "ma120"]
    assert len(rows[0]) == 11


def test_upsert_with_source_kiwoom(monkeypatch):
    ch = _FakeCH()
    monkeypatch.setattr(cho, "get_client", lambda: ch)
    assert cho.upsert_daily_prices("005930", REC, source="kiwoom") == 1
    _, rows, cols = ch.inserts[0]
    assert cols[-1] == "source" and rows[0][-1] == "kiwoom"


def test_ensure_source_column_is_idempotent_alter():
    ch = _FakeCH()
    chs.ensure_daily_prices_source(ch)
    assert len(ch.commands) == 1
    sql = ch.commands[0]
    assert "ALTER TABLE" in sql and "daily_prices" in sql and "ADD COLUMN IF NOT EXISTS" in sql
    assert "source LowCardinality(String) DEFAULT 'kis'" in sql


def test_daily_prices_ddl_has_source_default_kis():
    assert "source       LowCardinality(String) DEFAULT 'kis'" in chs.DAILY_PRICES_DDL

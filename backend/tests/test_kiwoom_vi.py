"""키움 VI 발동(ka10054) — body·연속조회, 정규화(소수·부호 두 개), 종목별 집계·병합, 장중 판정, 연속 실패 중단,
키 없음 skipped, 태스크·beat. HTTP·Redis 는 가짜(실제 키움 호출 없음)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import fakeredis
import pytest

from apps.collector.kiwoom import client as kc
from apps.collector.kiwoom import vi
from apps.collector.kiwoom.client import KiwoomApiError, KiwoomClient, KiwoomConnectionError, KiwoomIpError
from apps.collector.kiwoom.normalize import to_float, vi_row
from shared import featured_store
from shared.kiwoom_config import KiwoomConfig

CFG = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef", rate_per_sec=4)
KST = timezone(timedelta(hours=9))
DAY = date(2026, 11, 17)  # 화요일(거래일)
NOW = datetime(2026, 11, 17, 10, 5, tzinfo=KST)


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


def _client(script):
    token = _ok({"token": "T", "expires_dt": "20991231235959"})
    return KiwoomClient(CFG, limiter=_Limiter(), session=_Session([token, *script]),
                        redis_client=fakeredis.FakeRedis(decode_responses=True))


def _raw(cd="005930", nm="삼성전자", t="100311", kind="동적", dyn="+3.30", st="0.00", cnt="1", ex="KRX",
         price="67000"):
    return {"stk_cd": cd, "stk_nm": nm, "acc_trde_qty": "1105968", "motn_pric": price, "dynm_dispty_rt": dyn,
            "trde_cntr_proc_time": t, "virelis_time": "100511", "viaplc_tp": kind, "dynm_stdpc": "61300",
            "static_stdpc": "0", "static_dispty_rt": st, "open_pric_pre_flu_rt": "+16.93", "vimotn_cnt": cnt,
            "stex_tp": ex}


# ------------------------------------------------------------------ 클라이언트
def test_vi_body_matches_spec_fields():
    b = kc.vi_body()
    assert b == {"mrkt_tp": "000", "bf_mkrt_tp": "0", "stk_cd": "", "motn_tp": "0", "skip_stk": "100000011",
                 "trde_qty_tp": "0", "min_trde_qty": "0", "max_trde_qty": "0", "trde_prica_tp": "0",
                 "min_trde_prica": "0", "max_trde_prica": "0", "motn_drc": "0", "stex_tp": "3"}
    assert all(isinstance(v, str) for v in b.values())
    assert len(b["skip_stk"]) == 9


def test_vi_stocks_paginates_motn_stk():
    c = _client([_ok({"motn_stk": [_raw()]}, {"cont-yn": "Y", "next-key": "K1"}),
                 _ok({"motn_stk": [_raw(cd="000660")]})])
    rows = c.vi_stocks()
    assert [r["stk_cd"] for r in rows] == ["005930", "000660"]
    calls = c._session.calls[1:]
    assert calls[0]["url"].endswith("/api/dostk/stkinfo") and calls[0]["headers"]["api-id"] == "ka10054"
    assert calls[1]["headers"]["cont-yn"] == "Y" and calls[1]["headers"]["next-key"] == "K1"


# ------------------------------------------------------------------ 정규화
def test_to_float_keeps_decimals_and_double_sign():
    assert to_float("+9.30") == 9.3
    assert to_float("-3.13") == -3.13
    assert to_float("+-1.25") == -1.25  # 부호 두 개
    assert to_float("0.00") == 0.0
    assert to_float("") == 0.0 and to_float(None) == 0.0 and to_float("abc") == 0.0


def test_vi_row_normalizes():
    r = vi_row(_raw(cd="A005930_AL", t="91503", dyn="-3.13", cnt="22", ex="NXT", price="-65000"))
    assert r == {"ticker": "005930", "name": "삼성전자", "time": "09:15:03", "released_at": "10:05:11",
                 "kind": "동적", "direction": "down", "price": 65000, "rate": -3.13, "dynamic_rate": -3.13,
                 "static_rate": 0.0, "open_rate": 16.93, "count": 22, "exchange": "NXT"}
    # 정적만 발동이면 정적 괴리율로 방향
    s = vi_row(_raw(kind="정적", dyn="0.00", st="+10.01"))
    assert s["direction"] == "up" and s["rate"] == 10.01
    assert vi_row(_raw(cd="")) is None


# ------------------------------------------------------------------ 집계·병합
def test_aggregate_latest_time_and_max_count():
    rows = [vi_row(_raw(t="100311", cnt="2", ex="KRX", dyn="+3.30")),
            vi_row(_raw(t="093000", cnt="1", ex="KRX", dyn="+2.00")),
            vi_row(_raw(t="101500", cnt="5", ex="NXT", dyn="-2.10")),
            vi_row(_raw(cd="000660", nm="SK하이닉스", t="094000", cnt="0"))]
    agg = vi.aggregate(rows)
    assert agg["005930"]["time"] == "10:15:00" and agg["005930"]["direction"] == "down"
    assert agg["005930"]["count"] == 5 and agg["005930"]["exchange"] == "NXT"
    assert agg["000660"]["count"] == 1  # 발동 횟수가 0·없으면 행 수로


def test_merge_keeps_earlier_tickers_and_newer_times():
    prev = {"005930": {**vi_row(_raw(t="100000")), "count": 3},
            "000660": vi_row(_raw(cd="000660", t="093000"))}
    fresh = {"005930": {**vi_row(_raw(t="101000")), "count": 2}}
    merged = vi.merge(prev, fresh)
    assert set(merged) == {"005930", "000660"}  # 이번 응답에 없던 종목도 남긴다
    assert merged["005930"]["time"] == "10:10:00" and merged["005930"]["count"] == 3


# ------------------------------------------------------------------ 장중 판정
@pytest.mark.parametrize("hm,ok", [((8, 59), False), ((9, 0), True), ((15, 30), True), ((15, 31), False)])
def test_window_bounds(hm, ok):
    assert vi.in_vi_window(datetime(2026, 11, 17, *hm, tzinfo=KST)) is ok


def test_window_closed_on_weekend_and_rejects_naive():
    assert vi.in_vi_window(datetime(2026, 11, 21, 10, 0, tzinfo=KST)) is False  # 토요일
    with pytest.raises(ValueError):
        vi.in_vi_window(datetime(2026, 11, 17, 10, 0))


# ------------------------------------------------------------------ poll(연속 실패 중단)
class _FakeVi:
    def __init__(self, result):
        self.result = result
        self.closed = False

    def vi_stocks(self, **k):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def close(self):
        self.closed = True


def test_poll_saves_merged_snapshot_and_resets_failures():
    r = fakeredis.FakeRedis(decode_responses=True)
    featured_store.vi_record_failure(r, DAY)
    fake = _FakeVi([_raw(t="100311"), _raw(cd="000660", nm="SK하이닉스", t="094000", dyn="-2.0")])
    out = vi.poll(client_factory=lambda: fake, redis=r, now=NOW)
    assert out == {"rows": 2, "stocks": 2} and fake.closed
    snap = featured_store.load_vi(r, DAY)
    assert snap["date"] == "2026-11-17" and snap["count"] == 2
    assert [x["ticker"] for x in snap["items"]] == ["005930", "000660"]  # 최근 발동 먼저
    assert snap["updated_at"].startswith("2026-11-17T10:05")
    assert r.ttl(featured_store.vi_key(DAY)) <= 2 * 24 * 3600
    assert featured_store.vi_failures(r, DAY) == 0


def test_poll_empty_result_still_writes_empty_snapshot():
    r = fakeredis.FakeRedis(decode_responses=True)
    assert vi.poll(client_factory=lambda: _FakeVi([]), redis=r, now=NOW) == {"rows": 0, "stocks": 0}
    assert featured_store.load_vi(r, DAY) == {"date": "2026-11-17", "updated_at": NOW.isoformat(), "count": 0,
                                              "items": []}


def test_poll_halts_after_consecutive_failures():
    r = fakeredis.FakeRedis(decode_responses=True)
    calls = []

    def factory():
        calls.append(1)
        return _FakeVi(KiwoomConnectionError("down"))

    for i in range(vi.MAX_FAILS):
        out = vi.poll(client_factory=factory, redis=r, now=NOW)
        assert "error" in out
    assert featured_store.vi_halted(r, DAY)
    out = vi.poll(client_factory=factory, redis=r, now=NOW)
    assert out == {"skipped": "연속 실패로 오늘 VI 수집 중단"}
    assert len(calls) == vi.MAX_FAILS  # 중단 뒤에는 클라이언트도 만들지 않는다
    assert featured_store.vi_halted(r, DAY + timedelta(days=1)) is False  # 다음 날은 다시


def test_poll_success_between_failures_resets_counter():
    r = fakeredis.FakeRedis(decode_responses=True)
    vi.poll(client_factory=lambda: _FakeVi(KiwoomApiError(1, "x")), redis=r, now=NOW)
    vi.poll(client_factory=lambda: _FakeVi([]), redis=r, now=NOW)
    vi.poll(client_factory=lambda: _FakeVi(KiwoomApiError(1, "x")), redis=r, now=NOW)
    assert featured_store.vi_failures(r, DAY) == 1 and not featured_store.vi_halted(r, DAY)


def test_poll_ip_error_halts_immediately():
    r = fakeredis.FakeRedis(decode_responses=True)
    out = vi.poll(client_factory=lambda: _FakeVi(KiwoomIpError(8010, "ip")), redis=r, now=NOW)
    assert "error" in out and featured_store.vi_halted(r, DAY)


def test_poll_failure_keeps_previous_snapshot():
    r = fakeredis.FakeRedis(decode_responses=True)
    vi.poll(client_factory=lambda: _FakeVi([_raw()]), redis=r, now=NOW)
    vi.poll(client_factory=lambda: _FakeVi(KiwoomConnectionError("down")), redis=r, now=NOW)
    assert featured_store.load_vi(r, DAY)["count"] == 1


# ------------------------------------------------------------------ 태스크·beat
def test_task_skipped_without_keys(monkeypatch):
    from apps.collector.tasks import featured as ft
    monkeypatch.setattr(ft, "get_kiwoom_config", lambda: KiwoomConfig("", "", 4))
    monkeypatch.setattr(ft, "get_sync_redis", lambda: pytest.fail("키 없으면 Redis 도 건드리지 않음"))
    assert ft.poll_vi_stocks() == {"skipped": "키움 키 없음"}


def test_task_skipped_outside_window(monkeypatch):
    from apps.collector.tasks import featured as ft
    monkeypatch.setattr(ft, "get_kiwoom_config", lambda: CFG)
    monkeypatch.setattr(ft.trading_day, "now_kst", lambda: datetime(2026, 11, 17, 16, 0, tzinfo=KST))
    monkeypatch.setattr(ft, "get_sync_redis", lambda: pytest.fail("장 밖이면 Redis·키움 호출 없음"))
    assert ft.poll_vi_stocks() == {"skipped": "closed"}


def test_task_polls_in_window(monkeypatch):
    from apps.collector.tasks import featured as ft
    r = fakeredis.FakeRedis(decode_responses=True)
    seen = {}
    monkeypatch.setattr(ft, "get_kiwoom_config", lambda: CFG)
    monkeypatch.setattr(ft.trading_day, "now_kst", lambda: NOW)
    monkeypatch.setattr(ft, "get_sync_redis", lambda: r)
    monkeypatch.setattr(ft.vi, "poll", lambda **k: seen.update(k) or {"rows": 0, "stocks": 0})
    assert ft.poll_vi_stocks() == {"rows": 0, "stocks": 0}
    assert seen["redis"] is r and seen["now"] == NOW and seen["client_factory"] is ft._kiwoom_client


def test_task_registered_and_beat():
    from apps.collector.celery_app import celery_app
    from apps.collector.tasks import featured as ft

    assert ft.poll_vi_stocks.name == "collector.poll_vi_stocks"
    e = celery_app.conf.beat_schedule["poll-vi-stocks"]
    assert e["task"] == "collector.poll_vi_stocks"
    assert e["schedule"].minute == set(range(0, 60, 5)) and e["schedule"].hour == set(range(9, 16))
    assert e["schedule"].day_of_week == {1, 2, 3, 4, 5}
    assert e["options"]["expires"] < 300

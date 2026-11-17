"""apps.collector.kiwoom.client — 토큰 캐시·재시도·연속조회. HTTP·Redis 는 모두 가짜(실제 호출 없음)."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import fakeredis
import pytest
import requests

from apps.collector.kiwoom import client as kc
from apps.collector.kiwoom.client import (
    KiwoomApiError,
    KiwoomClient,
    KiwoomConnectionError,
    KiwoomIpError,
    KiwoomNotConfigured,
    token_ttl,
)
from shared.kiwoom_config import KiwoomConfig

CFG = KiwoomConfig(app_key="FAKEAPPKEY1234567890", app_secret="FAKESECRET-abcdef", rate_per_sec=4)
TOKEN_KEY = "kiwoom:token:prod:FAKEAPPKEY"
FAR_FUTURE = "20991231235959"


class _Resp:
    def __init__(self, status_code=200, body=None, headers=None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def _ok(body=None, headers=None):
    data = {"return_code": 0, "return_msg": "정상적으로 처리되었습니다"}
    data.update(body or {})
    return _Resp(200, data, headers)


def _token_resp(token="TOKEN-A", expires_dt=FAR_FUTURE):
    return _ok({"token": token, "token_type": "bearer", "expires_dt": expires_dt})


class _FakeSession:
    """post 호출마다 script 항목을 순서대로 재생(예외면 raise). 호출 기록을 남긴다."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": dict(headers or {})})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


class _CountingLimiter:
    def __init__(self):
        self.n = 0

    def acquire(self):
        self.n += 1


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(kc.time, "sleep", lambda s: None)
    monkeypatch.setattr("apps.collector.rate_limit.time.sleep", lambda s: None)


@pytest.fixture
def redis_client():
    return fakeredis.FakeRedis(decode_responses=True)


def _client(script, redis_client, limiter=None):
    return KiwoomClient(CFG, limiter=limiter or _CountingLimiter(), session=_FakeSession(script),
                        redis_client=redis_client)


# ------------------------------------------------------------------ 생성
def test_not_configured_raises():
    with pytest.raises(KiwoomNotConfigured):
        KiwoomClient(KiwoomConfig(app_key="", app_secret="", rate_per_sec=4))


def test_default_limiter_uses_config_rate(redis_client):
    c = KiwoomClient(CFG, session=_FakeSession([]), redis_client=redis_client)
    assert c._limiter is not None


# ------------------------------------------------------------------ 토큰
def test_issue_token_body_and_cache(redis_client):
    c = _client([_token_resp("TOKEN-A")], redis_client)
    assert c.get_token() == "TOKEN-A"
    call = c._session.calls[0]
    assert call["url"] == "https://api.kiwoom.com/oauth2/token"
    assert call["json"] == {"grant_type": "client_credentials", "appkey": CFG.app_key, "secretkey": CFG.app_secret}
    cached = json.loads(redis_client.get(TOKEN_KEY))
    assert cached == {"token": "TOKEN-A", "expires_dt": FAR_FUTURE}
    assert redis_client.ttl(TOKEN_KEY) > 60


def test_cached_token_reused_without_http(redis_client):
    redis_client.set(TOKEN_KEY, json.dumps({"token": "CACHED", "expires_dt": FAR_FUTURE}), ex=3600)
    c = _client([], redis_client)
    info = c.get_token_info()
    assert info.token == "CACHED" and info.cached is True
    assert info.expires_at.year == 2099
    assert c._session.calls == []


def test_token_ttl_subtracts_600s_kst():
    now = datetime(2026, 11, 16, 10, 0, 0, tzinfo=kc.KST)
    assert token_ttl("20261116110000", now) == 3600 - 600


def test_token_ttl_when_server_clock_is_utc():
    # 컨테이너가 UTC 여도 expires_dt(KST)와 올바르게 비교해야 한다(9시간 오차 금지)
    now_utc = datetime(2026, 11, 16, 1, 0, 0, tzinfo=timezone.utc)  # = KST 10:00
    assert token_ttl("20261116110000", now_utc) == 3000


def test_token_ttl_minimum_60():
    now = datetime(2026, 11, 16, 10, 0, 0, tzinfo=kc.KST)
    assert token_ttl("20261116100500", now) == 60
    assert token_ttl("garbage", now) == kc._FALLBACK_TTL


def test_token_issue_error_code_raises(redis_client):
    c = _client([_Resp(200, {"return_code": 8001, "return_msg": "App Key와 Secret Key 검증에 실패했습니다"})],
                redis_client)
    with pytest.raises(KiwoomApiError) as ei:
        c.get_token()
    assert ei.value.code == 8001
    assert CFG.app_secret not in str(ei.value) and CFG.app_key not in str(ei.value)


# ------------------------------------------------------------------ 요청
def test_post_headers_and_continuation(redis_client):
    c = _client([_token_resp("TOKEN-A"), _ok({"x": 1}, headers={"cont-yn": "Y", "next-key": "NK1"})], redis_client)
    r = c.post("ka10081", "/api/dostk/chart", {"stk_cd": "005930"}, cont_key="PREV")
    assert r.data["x"] == 1 and r.cont_yn is True and r.next_key == "NK1"
    h = c._session.calls[1]["headers"]
    assert h["api-id"] == "ka10081"
    assert h["authorization"] == "Bearer TOKEN-A"
    assert h["cont-yn"] == "Y" and h["next-key"] == "PREV"
    assert c._session.calls[1]["url"] == "https://api.kiwoom.com/api/dostk/chart"


def test_post_without_cont_key_has_no_cont_headers(redis_client):
    c = _client([_token_resp(), _ok()], redis_client)
    r = c.post("ka10099", "/api/dostk/stkinfo", {"mrkt_tp": "0"})
    assert r.cont_yn is False and r.next_key == ""
    assert "cont-yn" not in c._session.calls[1]["headers"]


def test_8005_reissues_token_once_then_succeeds(redis_client):
    redis_client.set(TOKEN_KEY, json.dumps({"token": "OLD", "expires_dt": FAR_FUTURE}), ex=3600)
    c = _client([_Resp(200, {"return_code": 8005, "return_msg": "Token이 유효하지 않습니다"}),
                 _token_resp("NEW"), _ok({"ok": True})], redis_client)
    assert c.post("ka10081", "/api/dostk/chart", {}).data["ok"] is True
    assert c._session.calls[2]["headers"]["authorization"] == "Bearer NEW"


def test_8005_twice_fails_without_loop(redis_client):
    bad = {"return_code": 8005, "return_msg": "Token이 유효하지 않습니다"}
    c = _client([_token_resp("A"), _Resp(200, bad), _token_resp("B"), _Resp(200, bad)], redis_client)
    with pytest.raises(KiwoomApiError) as ei:
        c.post("ka10081", "/api/dostk/chart", {})
    assert ei.value.code == 8005
    assert len(c._session.calls) == 4


def test_8005_as_http_401_still_reissues(redis_client):
    c = _client([_token_resp("A"), _Resp(401, {"return_code": 8005, "return_msg": "Token이 유효하지 않습니다"}),
                 _token_resp("B"), _ok({"ok": 1})], redis_client)
    assert c.post("ka10081", "/api/dostk/chart", {}).data["ok"] == 1


def test_8010_ip_error_fails_immediately(redis_client):
    c = _client([_token_resp(), _Resp(200, {"return_code": "8010", "return_msg": "IP 불일치"})], redis_client)
    with pytest.raises(KiwoomIpError) as ei:
        c.post("ka10081", "/api/dostk/chart", {})
    assert "상용 서버" in str(ei.value)
    assert len(c._session.calls) == 2


def test_rate_limit_1700_backoff_then_success(redis_client):
    limiter = _CountingLimiter()
    c = _client([_token_resp(), _Resp(200, {"return_code": 1700, "return_msg": "한도"}),
                 _Resp(200, {"return_code": 1702, "return_msg": "그룹 한도"}), _ok({"ok": 1})],
                redis_client, limiter)
    assert c.post("ka10081", "/api/dostk/chart", {}).data["ok"] == 1
    assert limiter.n == 4  # 토큰 1 + 요청 3(재시도 포함 모두 리미터를 거친다)


def test_rate_limit_gives_up_after_3_retries(redis_client):
    lim = {"return_code": 1701, "return_msg": "전체 한도"}
    c = _client([_token_resp()] + [_Resp(200, lim)] * 4, redis_client)
    with pytest.raises(KiwoomApiError) as ei:
        c.post("ka10081", "/api/dostk/chart", {})
    assert ei.value.code == 1701
    assert len(c._session.calls) == 5  # 토큰 1 + 첫 시도 1 + 재시도 3


def test_5xx_and_timeout_retry_then_success(redis_client):
    c = _client([_token_resp(), _Resp(502, None), requests.Timeout("t"), requests.ConnectionError("c"),
                 _ok({"ok": 1})], redis_client)
    assert c.post("ka10081", "/api/dostk/chart", {}).data["ok"] == 1


def test_connection_errors_exhausted(redis_client):
    c = _client([_token_resp()] + [requests.ConnectionError("boom")] * 4, redis_client)
    with pytest.raises(KiwoomConnectionError):
        c.post("ka10081", "/api/dostk/chart", {})
    assert len(c._session.calls) == 5
    assert issubclass(KiwoomConnectionError, RuntimeError)


def test_backoff_sleeps_1_5_pow_n(monkeypatch, redis_client):
    slept: list[float] = []
    monkeypatch.setattr(kc.time, "sleep", slept.append)
    c = _client([_token_resp()] + [_Resp(503, None)] * 4, redis_client)
    with pytest.raises(KiwoomConnectionError):
        c.post("ka10081", "/api/dostk/chart", {})
    assert slept == [1.0, 1.5, 2.25]


@pytest.mark.parametrize("resp", [
    _Resp(200, {"return_code": 1902, "return_msg": "종목 정보가 없습니다"}),
    _Resp(404, None),
    _Resp(400, {"error": "bad"}),
])
def test_other_errors_fail_immediately(redis_client, resp):
    c = _client([_token_resp(), resp], redis_client)
    with pytest.raises(KiwoomApiError):
        c.post("ka10081", "/api/dostk/chart", {})
    assert len(c._session.calls) == 2


def test_error_message_has_no_secrets(redis_client):
    c = _client([_token_resp("SECRET-TOKEN-XYZ"), _Resp(200, {"return_code": 1903, "return_msg": "거래소구분"})],
                redis_client)
    with pytest.raises(KiwoomApiError) as ei:
        c.post("ka10081", "/api/dostk/chart", {})
    text = str(ei.value)
    assert "SECRET-TOKEN-XYZ" not in text and CFG.app_secret not in text and CFG.app_key not in text
    assert ei.value.code == 1903


# ------------------------------------------------------------------ 연속조회·메서드
def test_get_daily_chart_paginates(redis_client):
    p1 = _ok({"stk_dt_pole_chart_qry": [{"dt": "20260805"}, {"dt": "20260804"}]},
             headers={"cont-yn": "Y", "next-key": "K2"})
    p2 = _ok({"stk_dt_pole_chart_qry": [{"dt": "20260801"}]}, headers={"cont-yn": "N"})
    c = _client([_token_resp(), p1, p2], redis_client)
    rows = c.get_daily_chart("005930_AL", "20260805", max_pages=5)
    assert [r["dt"] for r in rows] == ["20260805", "20260804", "20260801"]
    first, second = c._session.calls[1], c._session.calls[2]
    assert first["json"] == {"stk_cd": "005930_AL", "base_dt": "20260805", "upd_stkpc_tp": "1"}
    assert second["headers"]["cont-yn"] == "Y" and second["headers"]["next-key"] == "K2"


def test_get_daily_chart_respects_max_pages_and_unadjusted(redis_client):
    p1 = _ok({"stk_dt_pole_chart_qry": [{"dt": "20260805"}]}, headers={"cont-yn": "Y", "next-key": "K2"})
    c = _client([_token_resp(), p1], redis_client)
    rows = c.get_daily_chart("005930", "20260805", adjusted=False)
    assert len(rows) == 1 and len(c._session.calls) == 2
    assert c._session.calls[1]["json"]["upd_stkpc_tp"] == "0"


def test_paginate_stops_when_next_key_missing(redis_client):
    p1 = _ok({"list": [{"code": "1"}]}, headers={"cont-yn": "Y", "next-key": ""})
    c = _client([_token_resp(), p1], redis_client)
    assert len(c.list_stocks("0")) == 1


def test_list_stocks_reads_to_end(redis_client):
    p1 = _ok({"list": [{"code": "005930", "nxtEnable": "Y"}]}, headers={"cont-yn": "Y", "next-key": "A"})
    p2 = _ok({"list": [{"code": "293490", "nxtEnable": "N"}]}, headers={"cont-yn": "N"})
    c = _client([_token_resp(), p1, p2], redis_client)
    rows = c.list_stocks("10")
    assert [r["code"] for r in rows] == ["005930", "293490"]
    assert c._session.calls[1]["json"] == {"mrkt_tp": "10"}
    assert c._session.calls[1]["headers"]["api-id"] == "ka10099"


# ------------------------------------------------------------------ ka10058 투자자별일별매매종목
def test_investor_daily_body_codes():
    b = kc.investor_daily_body("pension", "20261117", "20261117", "kosdaq")
    assert b == {"strt_dt": "20261117", "end_dt": "20261117", "trde_tp": "2", "mrkt_tp": "101",
                 "invsr_tp": "6000", "stex_tp": "3"}
    assert kc.investor_daily_body("foreign", "a", "b", "kospi")["invsr_tp"] == "9000"
    assert kc.investor_daily_body("institution", "a", "b", "kospi")["mrkt_tp"] == "001"
    assert kc.investor_daily_body("institution", "a", "b", "kospi")["invsr_tp"] == "9999"  # 기관계
    with pytest.raises(ValueError):
        kc.investor_daily_body("retail", "a", "b", "kospi")
    with pytest.raises(ValueError):
        kc.investor_daily_body("foreign", "a", "b", "konex")


def test_investor_daily_top_path_header_and_pages(redis_client):
    p1 = _ok({"invsr_daly_trde_stk": [{"stk_cd": "005930"}]}, headers={"cont-yn": "Y", "next-key": "N2"})
    p2 = _ok({"invsr_daly_trde_stk": [{"stk_cd": "000660"}]}, headers={"cont-yn": "Y", "next-key": "N3"})
    c = _client([_token_resp(), p1, p2], redis_client)
    rows = c.investor_daily_top("foreign", "20261117", "20261117", "kospi", max_pages=2)
    assert [r["stk_cd"] for r in rows] == ["005930", "000660"]  # max_pages 에서 멈춤
    call = c._session.calls[1]
    assert call["url"].endswith("/api/dostk/stkinfo") and call["headers"]["api-id"] == "ka10058"
    assert call["json"]["invsr_tp"] == "9000" and call["json"]["trde_tp"] == "2"

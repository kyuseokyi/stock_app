"""apps.collector.kiwoom.probe — 실측 도구. 키움·CH 는 모두 가짜(실제 호출 없음)."""

from __future__ import annotations

from datetime import date, datetime

import pytest

from apps.collector.kiwoom import probe
from apps.collector.kiwoom.client import KST, KiwoomApiError, KiwoomIpError, TokenInfo
from shared.kiwoom_config import KiwoomConfig

FAKE_KEY = "FAKEAPPKEY-should-not-print"
FAKE_SECRET = "FAKESECRET-should-not-print"
FAKE_TOKEN = "FAKETOKEN-should-not-print"


def _raw(dt, close, vol, prica="1000"):
    return {"dt": dt, "open_pric": "+240000", "high_pric": "245000", "low_pric": "-239000",
            "cur_prc": close, "trde_qty": vol, "trde_prica": prica}


class _FakeClient:
    def __init__(self, charts: dict, stocks: dict, token_error: Exception | None = None):
        self.charts, self.stocks, self.token_error = charts, stocks, token_error
        self.calls: list[str] = []

    def get_token_info(self):
        if self.token_error:
            raise self.token_error
        return TokenInfo(FAKE_TOKEN, datetime(2026, 11, 17, 10, 23, tzinfo=KST), cached=False)

    def get_daily_chart(self, stk_cd, base_dt, *, adjusted=True, max_pages=1):
        self.calls.append(stk_cd)
        v = self.charts.get(stk_cd, [])
        if isinstance(v, Exception):
            raise v
        return v

    def list_stocks(self, mrkt_tp):
        return self.stocks.get(mrkt_tp, [])

    def close(self):
        pass


def _fake_client():
    return _FakeClient(
        charts={
            "005930": [_raw("20260805", "246000", "22500000"), _raw("20260804", "240000", "1")],
            "005930_NX": [_raw("20260805", "246000", "20800000")],
            "005930_AL": [_raw("20260805", "-242000", "43300000", "10500000")],
            "293490_AL": KiwoomApiError(1903, "종목 정보가 없습니다"),
            "293490": [_raw("20260805", "21000", "500000")],
        },
        stocks={"0": [{"code": "005930", "nxtEnable": "Y"}, {"code": "000001", "nxtEnable": "N"}],
                "10": [{"code": "293490", "nxtEnable": "N"}]},
    )


def _ch_ok(ticker, d):
    return {"open": 240000.0, "high": 245000.0, "low": 239000.0, "close": 242000.0, "volume": 43300000,
            "trading_value": None}


def _run(client, ch=_ch_ok, argv=()):
    lines: list[str] = []
    code = probe.run(probe.parse_args(list(argv)), client=client, ch_fetch=ch, out=lines.append)
    return code, "\n".join(lines)


# ------------------------------------------------------------------ 순수 함수
def test_pick_row_selects_exact_date():
    rows = [_raw("20260805", "1", "1"), _raw("20260804", "2", "2")]
    assert probe.pick_row(rows, "20260804")["close"] == 2.0
    assert probe.pick_row(rows, "20260801") is None


def test_compare_match_and_mismatch():
    a = {"close": 242000.0, "volume": 43300000}
    assert probe.compare(a, {"close": 242000.0, "volume": 43300000}) == {"close": True, "volume": True}
    assert probe.compare(a, {"close": 246000.0, "volume": 22500000}) == {"close": False, "volume": False}
    assert probe.compare(a, None) is None
    assert probe.compare("오류", a) is None


def test_mark():
    assert probe.mark(True) == "✅" and probe.mark(False) == "❌"


# ------------------------------------------------------------------ 실행
def test_run_full_output_and_no_secrets():
    code, text = _run(_fake_client())
    assert code == 0
    assert "[OK] 토큰 발급 — 만료 2026-11-17 10:23" in text
    assert "005930_AL" in text and "CH daily_prices FINAL" in text
    assert "종가 ✅" in text and "거래량 ✅" in text
    assert "1903" in text  # NXT 미상장 _AL 오류코드
    assert "코스피 2개 (nxtEnable=Y 1개)" in text and "코스닥 1개 (nxtEnable=Y 0개)" in text
    assert "요약" in text
    for secret in (FAKE_KEY, FAKE_SECRET, FAKE_TOKEN):
        assert secret not in text


def test_run_mismatch_marks_x():
    def ch(t, d):
        return {"open": 1.0, "high": 1.0, "low": 1.0, "close": 246000.0, "volume": 22500000, "trading_value": None}

    _, text = _run(_fake_client(), ch=ch)
    assert "종가 ❌" in text and "거래량 ❌" in text


def test_run_ch_unavailable_continues():
    def ch(t, d):
        raise ConnectionError("CH 다운")

    code, text = _run(_fake_client(), ch=ch)
    assert code == 0
    assert "조회 불가" in text
    assert "코스피 2개" in text  # 다음 단계도 계속


def test_run_missing_row_shows_no_row():
    c = _fake_client()
    c.charts["005930_NX"] = [_raw("20260804", "1", "1")]
    _, text = _run(c)
    assert "행 없음" in text


def test_run_token_ip_error_stops_with_message():
    c = _fake_client()
    c.token_error = KiwoomIpError(8010, "IP 불일치")
    code, text = _run(c)
    assert code == 1
    assert "상용 서버" in text
    assert c.calls == []


def test_run_uses_custom_args():
    c = _fake_client()
    c.charts["000660_AL"] = []
    _run(c, argv=["--ticker", "000660", "--date", "20260805", "--non-nxt", "293490"])
    assert "000660_AL" in c.calls and "293490" in c.calls


def test_main_without_keys_exits_0_without_calls(monkeypatch, capsys):
    monkeypatch.setattr(probe, "get_kiwoom_config", lambda: KiwoomConfig(app_key="", app_secret=""))

    def boom(*a, **k):
        raise AssertionError("키 없을 때 클라이언트를 만들면 안 된다")

    monkeypatch.setattr(probe, "KiwoomClient", boom)
    assert probe.main([]) == 0
    assert "키움 키가 설정되지 않았어요" in capsys.readouterr().out


def test_main_does_not_print_keys(monkeypatch, capsys):
    monkeypatch.setattr(probe, "get_kiwoom_config",
                        lambda: KiwoomConfig(app_key=FAKE_KEY, app_secret=FAKE_SECRET))
    monkeypatch.setattr(probe, "KiwoomClient", lambda cfg: _fake_client())
    monkeypatch.setattr(probe, "ch_daily_bar", _ch_ok)
    assert probe.main([]) == 0
    out = capsys.readouterr().out
    for secret in (FAKE_KEY, FAKE_SECRET, FAKE_TOKEN):
        assert secret not in out


def test_parse_args_defaults():
    a = probe.parse_args([])
    assert (a.ticker, a.date, a.non_nxt) == ("005930", "20260805", "293490")


def test_parse_date():
    assert probe.parse_yyyymmdd("20260805") == date(2026, 8, 5)
    with pytest.raises(SystemExit):
        probe.parse_args(["--date", "2026-08-05"])

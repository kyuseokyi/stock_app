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


# ------------------------------------------------------------------ --lending (ka20068)
from apps.collector.kiwoom.client import KiwoomResponse  # noqa: E402


def _lend(dt, rmnd="98242435", amt="5452455", irds="-1482754"):
    return {"dt": dt, "dbrt_trde_cntrcnt": "1210354", "dbrt_trde_rpy": "2693108", "dbrt_trde_irds": irds,
            "rmnd": rmnd, "remn_amt": amt}


class _LendingClient(_FakeClient):
    def __init__(self, lending: dict):
        super().__init__(charts={}, stocks={})
        self.lending = lending
        self.posts: list[tuple] = []

    def post(self, api_id, path, body, *, cont_key=None):
        self.posts.append((api_id, path, body))
        v = self.lending.get(body["stk_cd"], [])
        if isinstance(v, Exception):
            raise v
        return KiwoomResponse(data={"dbrt_trde_trnsn": v}, cont_yn=False, next_key="")


def test_parse_args_lending_defaults():
    a = probe.parse_args(["--lending"])
    assert a.lending is True and probe.lending_tickers(a.lending_tickers) == ["005930", "000660"]
    assert probe.parse_args([]).lending is False
    assert probe.lending_tickers(" 005930, ,000660,005930,035420,051910") == ["005930", "000660", "035420"]


def test_run_lending_table_suffix_and_no_secrets():
    c = _LendingClient({
        "005930": [_lend("20261113"), _lend("20261112", rmnd="99725189", amt="5564666", irds="-520696")],
        "000660": [],
        "005930_AL": KiwoomApiError(1511, "종목코드 오류"),
    })
    lines: list[str] = []
    code = probe.run_lending(probe.parse_args(["--lending"]), client=c, out=lines.append, today=date(2026, 11, 16))
    text = "\n".join(lines)
    assert code == 0
    assert [p[2]["stk_cd"] for p in c.posts] == ["005930", "000660", "005930_AL"]
    assert all(p[0] == "ka20068" and p[1] == "/api/dostk/slb" for p in c.posts)
    assert c.posts[0][2] == {"strt_dt": "20261029", "end_dt": "20261116", "all_tp": "0", "stk_cd": "005930"}
    assert "2026-11-12" in text.split("2026-11-13")[0]  # 오래된 순
    assert "98,242,435" in text and "5,452,455,000,000" in text and "-1,482,754" in text
    assert "55,500" in text  # 금액/주 = 5,452,455백만원 / 98,242,435주 ≈ 55,500원(단위 확인)
    assert "최신 행 2026-11-13" in text and "cont-yn=N" in text
    assert "005930_AL (접미사): 오류 1511: 종목코드 오류" in text
    for secret in (FAKE_KEY, FAKE_SECRET, FAKE_TOKEN):
        assert secret not in text


def test_run_with_lending_flag_skips_daily_compare():
    c = _LendingClient({"005930": [_lend("20261113")]})
    code, text = _run(c, argv=["--lending", "--lending-tickers", "005930"])
    assert code == 0 and "[OK] 토큰" in text
    assert c.calls == []  # 일봉(ka10081) 은 부르지 않음
    assert "일봉 비교" not in text and "ka20068" in text


def test_run_lending_ip_error_is_reported_per_ticker():
    c = _LendingClient({"005930": KiwoomIpError(8010, "IP"), "000660": [_lend("20261113")]})
    lines: list[str] = []
    probe.run_lending(probe.parse_args(["--lending"]), client=c, out=lines.append, today=date(2026, 11, 16))
    text = "\n".join(lines)
    assert "005930: 오류 8010" in text and "000660: 1행" in text


# ------------------------------------------------------------------ 테마(ka90001·ka90002)
class _ThemeClient(_FakeClient):
    def __init__(self, pages: list, members=None, groups_error=None):
        super().__init__(charts={}, stocks={})
        self.pages, self.members, self.groups_error = list(pages), members, groups_error
        self.posts: list[tuple] = []

    def post(self, api_id, path, body, *, cont_key=None):
        self.posts.append((api_id, path, body, cont_key))
        if api_id == "ka90001":
            if self.groups_error and body["stex_tp"] == "3":
                raise self.groups_error
            rows, more = self.pages.pop(0) if self.pages else ([], False)
            return KiwoomResponse(data={"thema_grp": rows}, cont_yn=more, next_key="NK" if more else "")
        if isinstance(self.members, Exception):
            raise self.members
        return KiwoomResponse(data={"thema_comp_stk": self.members or []}, cont_yn=False, next_key="")


def _g(cd, nm, n):
    return {"thema_grp_cd": cd, "thema_nm": nm, "stk_num": n, "flu_rt": "+0.02", "dt_prft_rt": "+1.00"}


def test_parse_args_themes_flag():
    assert probe.parse_args(["--themes"]).themes is True and probe.parse_args([]).themes is False


def test_run_themes_counts_pages_and_members_without_secrets():
    p1 = ([_g(str(100 + i), f"테마{i}", "5") for i in range(12)], True)
    p2 = ([_g("200", "끝테마", "3")], False)
    c = _ThemeClient([p1, p2], members=[{"stk_cd": "005930_AL", "stk_nm": "삼성전자"},
                                        {"stk_cd": "000660", "stk_nm": "SK하이닉스"},
                                        {"stk_cd": "005930", "stk_nm": "삼성전자"}])
    code, text = _run(c, argv=["--themes"])
    assert code == 0 and c.calls == []  # 일봉 비교 안 함
    assert "테마 13개 · 2쪽(쪽별 [12, 1]) · 마지막 cont-yn=N" in text
    assert "테마9" in text and "테마10" not in text  # 앞 10개만
    assert c.posts[0][2]["stex_tp"] == "3" and c.posts[1][3] == "NK"
    assert c.posts[2][0] == "ka90002" and c.posts[2][2] == {"date_tp": "1", "thema_grp_cd": "100", "stex_tp": "3"}
    assert "응답 3행" in text and "정규화 2종목" in text and "005930_AL" in text
    for secret in (FAKE_KEY, FAKE_SECRET, FAKE_TOKEN):
        assert secret not in text


def test_run_themes_unified_rejected_retries_krx():
    c = _ThemeClient([([_g("100", "가", "1")], False)], groups_error=KiwoomApiError(1511, "거래소구분 오류"))
    code, text = _run(c, argv=["--themes"])
    assert code == 0
    assert "오류 1511" in text and "stex_tp=1(KRX) 재시도: 1행" in text
    assert [p[0] for p in c.posts] == ["ka90001", "ka90001"]  # 목록이 없으면 구성 종목은 부르지 않음


# ------------------------------------------------------------------ 투자자별 순매수(ka10058)
class _InvestorClient(_FakeClient):
    def __init__(self, data: dict):
        super().__init__(charts={}, stocks={})
        self.data = data  # (invsr_tp, mrkt_tp) → (rows, cont) 또는 예외
        self.posts: list[tuple] = []

    def post(self, api_id, path, body, *, cont_key=None):
        self.posts.append((api_id, path, body, cont_key))
        got = self.data.get((body["invsr_tp"], body["mrkt_tp"]), ([], False))
        if isinstance(got, Exception):
            raise got
        rows, more = got
        return KiwoomResponse(data={"invsr_daly_trde_stk": rows}, cont_yn=more, next_key="NK" if more else "")


def _iv(cd, nm, qty, amt, avg):
    return {"stk_cd": cd, "stk_nm": nm, "netslmt_qty": qty, "netslmt_amt": amt, "prsm_avg_pric": avg}


def test_previous_weekday():
    assert probe.previous_weekday(date(2026, 11, 17)) == date(2026, 11, 16)  # 화 → 월
    assert probe.previous_weekday(date(2026, 11, 16)) == date(2026, 11, 13)  # 월 → 금


def test_parse_args_investors():
    a = probe.parse_args(["--investors", "--investors-date", "20261116"])
    assert a.investors is True and a.investors_date == "20261116"
    assert probe.parse_args([]).investors is False and probe.parse_args([]).investors_date is None


def test_run_investors_top5_unit_and_errors_without_secrets():
    rows = [_iv(f"00{i:04d}_AL", f"종목{i}", "+10", f"+{100 - i}", "100000") for i in range(7)]
    c = _InvestorClient({
        ("9000", "001"): (rows, True),
        ("9000", "101"): ([_iv("247540", "에코프로비엠", "+1", "+500", "50000")], False),
        ("9999", "001"): KiwoomApiError(1999, "조회 가능 시간이 아닙니다"),
    })
    code, text = _run(c, argv=["--investors", "--investors-date", "20261116"])
    assert code == 0 and c.calls == []  # 일봉 비교 안 함
    assert len(c.posts) == 6 and all(p[0] == "ka10058" and p[1] == "/api/dostk/stkinfo" for p in c.posts)
    assert c.posts[0][2] == {"strt_dt": "20261116", "end_dt": "20261116", "trde_tp": "2", "mrkt_tp": "001",
                             "invsr_tp": "9000", "stex_tp": "3"}
    assert "외국인 코스피: 응답 7행 · cont-yn=Y" in text
    assert "기관계 코스피: 오류 1999" in text
    assert "연기금 코스닥: 응답 0행" in text
    # 상위 5종목: 두 시장 합쳐 금액 내림차순 — 에코프로비엠(500) 이 1위, 종목4~6 은 잘림
    assert text.index("에코프로비엠") < text.index("종목0") and "종목3" in text and "종목4" not in text
    assert "단위 추정 ×10,000" in text  # 10주 × 100,000 / 100 = 10,000
    assert "5,000,000" in text  # 에코프로비엠 500 × 1만 = 5,000,000원
    for secret in (FAKE_KEY, FAKE_SECRET, FAKE_TOKEN):
        assert secret not in text


def test_run_investors_ip_error_stops():
    c = _InvestorClient({("9000", "001"): KiwoomIpError(8010, "ip")})
    code, text = _run(c, argv=["--investors", "--investors-date", "20261116"])
    assert code == 0 and len(c.posts) == 1 and "등록된 IP" in text

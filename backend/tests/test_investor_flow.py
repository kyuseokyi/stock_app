"""시장 투자자별 순매수 집계 — 키움(가짜 클라이언트, 설정 시) → pykrx(가짜 모듈) → CH investor_daily(KIS) 폴백."""
import sys
import types
from datetime import date

import pandas as pd
import pytest

from apps.collector import investor_flow as inf

D = date(2026, 10, 30)


@pytest.fixture(autouse=True)
def _no_kiwoom(monkeypatch):
    """로컬 셸에 키움 키가 있어도 기존 테스트로 새지 않게 — 키움 테스트는 with_kiwoom 으로 켠다."""
    monkeypatch.delenv("KIWOOM_APP_KEY", raising=False)
    monkeypatch.delenv("KIWOOM_APP_SECRET", raising=False)


@pytest.fixture
def no_krx(monkeypatch):
    monkeypatch.delenv("KRX_ID", raising=False)
    monkeypatch.delenv("KRX_PW", raising=False)


@pytest.fixture
def with_krx(monkeypatch):
    monkeypatch.setenv("KRX_ID", "id")
    monkeypatch.setenv("KRX_PW", "pw")


def _install_fake_pykrx(monkeypatch, frames):
    """frames: {(market, investor): DataFrame}. 호출 기록을 calls 에 남긴다."""
    calls = []

    def get_market_net_purchases_of_equities(fromdate, todate, market, investor):
        calls.append((fromdate, todate, market, investor))
        return frames.get((market, investor), pd.DataFrame())

    fake_stock = types.SimpleNamespace(get_market_net_purchases_of_equities=get_market_net_purchases_of_equities)
    fake = types.ModuleType("pykrx")
    fake.stock = fake_stock
    monkeypatch.setitem(sys.modules, "pykrx", fake)
    monkeypatch.setitem(sys.modules, "pykrx.stock", fake_stock)
    return calls


def _df(rows):
    """rows: [(ticker, name, amount)] — pykrx 와 같이 인덱스=티커."""
    return pd.DataFrame({"종목명": [r[1] for r in rows], "순매수거래대금": [r[2] for r in rows]},
                        index=[r[0] for r in rows])


def test_no_credentials_does_not_import_pykrx(no_krx, monkeypatch):
    monkeypatch.delitem(sys.modules, "pykrx", raising=False)
    monkeypatch.delitem(sys.modules, "pykrx.stock", raising=False)
    before = set(sys.modules)
    assert inf.fetch_pykrx(D) is None
    assert not any(m == "pykrx" or m.startswith("pykrx.") for m in set(sys.modules) - before)


def test_no_credentials_never_calls_fake_pykrx(no_krx, monkeypatch):
    calls = _install_fake_pykrx(monkeypatch, {})
    assert inf.fetch_pykrx(D) is None and calls == []


def test_pykrx_aggregates_both_markets(with_krx, monkeypatch):
    calls = _install_fake_pykrx(monkeypatch, {
        ("KOSPI", "외국인"): _df([("005930", "삼성전자", 500), ("000660", "SK하이닉스", 300), ("035420", "NAVER", -50)]),
        ("KOSDAQ", "외국인"): _df([("247540", "에코프로비엠", 400)]),
        ("KOSPI", "기관합계"): _df([("000660", "SK하이닉스", 200), ("005930", "삼성전자", 100)]),
        ("KOSDAQ", "기관합계"): _df([("247540", "에코프로비엠", -10)]),
        ("KOSPI", "연기금"): _df([("005930", "삼성전자", 70)]),
    })
    raw = inf.fetch_pykrx(D)
    assert raw["source"] == "pykrx" and raw["date"] == "2026-10-30"
    assert [r["ticker"] for r in raw["foreign"]] == ["005930", "247540", "000660"]  # 음수 제외·두 시장 합쳐 정렬
    assert raw["pension"] == [{"ticker": "005930", "name": "삼성전자", "net_amount": 70.0}]
    assert ("20261030", "20261030", "KOSDAQ", "연기금") in calls and len(calls) == 6

    out = inf.collect(D)
    assert set(out) == {"date", "source", "foreign_top", "institution_top", "pension_top", "double_buy"}
    assert [r["ticker"] for r in out["double_buy"]] == ["005930", "000660"]  # 600 > 500
    assert out["double_buy"][0] == {"ticker": "005930", "name": "삼성전자", "foreign_amount": 500.0,
                                    "institution_amount": 100.0}


def test_pykrx_missing_columns_returns_none(with_krx, monkeypatch):
    _install_fake_pykrx(monkeypatch, {("KOSPI", "외국인"): pd.DataFrame({"이름": ["a"]}, index=["1"])})
    assert inf.fetch_pykrx(D) is None


def test_pykrx_all_empty_returns_none(with_krx, monkeypatch):
    _install_fake_pykrx(monkeypatch, {})
    assert inf.fetch_pykrx(D) is None


def test_pykrx_exception_returns_none(with_krx, monkeypatch):
    fake_stock = types.SimpleNamespace(get_market_net_purchases_of_equities=lambda *a: (_ for _ in ()).throw(
        RuntimeError("login")))
    fake = types.ModuleType("pykrx")
    fake.stock = fake_stock
    monkeypatch.setitem(sys.modules, "pykrx", fake)
    assert inf.fetch_pykrx(D) is None


def test_pool_and_top_limits(with_krx, monkeypatch):
    rows = [(f"{i:06d}", f"n{i}", 1000 - i) for i in range(70)]
    _install_fake_pykrx(monkeypatch, {("KOSPI", "외국인"): _df(rows), ("KOSPI", "기관합계"): _df(rows)})
    raw = inf.fetch_pykrx(D)
    assert len(raw["foreign"]) == inf.POOL_N
    out = inf.collect(D)
    assert len(out["foreign_top"]) == inf.TOP_N and len(out["double_buy"]) == inf.TOP_N


# --- KIS 폴백 ----------------------------------------------------------------- #
class _FakeCH:
    def __init__(self, results):
        self.results, self.queries = list(results), []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        return type("R", (), {"result_rows": self.results.pop(0) if self.results else []})()


@pytest.fixture
def universe(monkeypatch):
    from shared import market_repo
    monkeypatch.setattr(market_repo, "analysis_universe",
                        lambda s: [("005930", "삼성전자", "KOSPI"), ("000660", "SK하이닉스", "KOSPI"),
                                   ("247540", "에코프로비엠", "KOSDAQ")])


def test_kis_fallback_picks_latest_date_positive_only_and_filters_universe(no_krx, universe):
    used = date(2026, 10, 29)
    ch = _FakeCH([
        [(used,)],
        [("005930", 500, 100), ("000660", 300, 200), ("247540", -40, 900), ("069500", 9999, 9999)],  # 069500=ETF
    ])
    out = inf.collect(D, ch=ch, session=object())
    assert out["source"] == "kis" and out["date"] == "2026-10-29" and out["pension_top"] == []
    w = inf.KIS_AMT_TO_WON
    assert [(r["ticker"], r["net_amount"]) for r in out["foreign_top"]] == [("005930", 500 * w), ("000660", 300 * w)]
    assert [r["ticker"] for r in out["institution_top"]] == ["247540", "000660", "005930"]
    assert [r["ticker"] for r in out["double_buy"]] == ["005930", "000660"]  # 247540 은 외국인 음수
    assert "ORDER BY date DESC LIMIT 1" in ch.queries[0][0]
    assert ch.queries[0][1]["d"] == D
    assert "FINAL" in ch.queries[1][0] and ch.queries[1][1] == {"d": used}


def test_kis_fallback_no_data_returns_none(no_krx, universe):
    assert inf.collect(D, ch=_FakeCH([[]]), session=object()) is None
    assert inf.fetch_kis_fallback(_FakeCH([[(D,)], []]), D, session=object()) is None


def test_kis_fallback_ch_error_returns_none(no_krx, universe):
    class Boom:
        def query(self, *a, **k):
            raise RuntimeError("ch down")
    assert inf.fetch_kis_fallback(Boom(), D, session=object()) is None


def test_kis_fallback_empty_universe_uses_names(no_krx, monkeypatch):
    from shared import market_repo
    monkeypatch.setattr(market_repo, "analysis_universe", lambda s: [])
    monkeypatch.setattr(market_repo, "names_for", lambda s, t: {"005930": "삼성전자"})
    out = inf.fetch_kis_fallback(_FakeCH([[(D,)], [("005930", 5, 0)]]), D, session=object())
    assert out["foreign"][0]["name"] == "삼성전자"


def test_double_buy_helper():
    f = [{"ticker": "a", "name": "A", "net_amount": 10.0}, {"ticker": "b", "name": "B", "net_amount": 1.0},
         {"ticker": "c", "name": "C", "net_amount": -5.0}]
    i = [{"ticker": "b", "name": "B", "net_amount": 50.0}, {"ticker": "a", "name": "A", "net_amount": 1.0},
         {"ticker": "c", "name": "C", "net_amount": 100.0}]
    assert [r["ticker"] for r in inf.double_buy(f, i)] == ["b", "a"]


# --- 키움 ka10058 ------------------------------------------------------------- #
from apps.collector.kiwoom import client as kwc  # noqa: E402
from apps.collector.kiwoom.client import KiwoomApiError, KiwoomIpError  # noqa: E402
from apps.collector.kiwoom.normalize import KIWOOM_FLOW_AMT_TO_WON as KW  # noqa: E402


class _FakeKiwoom:
    """investor_daily_top 호출을 기록하고 (investor, market) → 원시 행 또는 예외를 돌려준다."""

    def __init__(self, data):
        self.data, self.calls, self.closed = data, [], False

    def investor_daily_top(self, investor, strt_dt, end_dt, market, *, max_pages=1):
        self.calls.append((investor, strt_dt, end_dt, market, max_pages))
        got = self.data.get((investor, market), [])
        if isinstance(got, Exception):
            raise got
        return got

    def close(self):
        self.closed = True


def _kw(code, name, amt):
    return {"stk_cd": code, "stk_nm": name, "netslmt_qty": "+1", "netslmt_amt": amt, "prsm_avg_pric": "1"}


@pytest.fixture
def with_kiwoom(monkeypatch):
    monkeypatch.setenv("KIWOOM_APP_KEY", "FAKEKEY")
    monkeypatch.setenv("KIWOOM_APP_SECRET", "FAKESECRET")

    def install(data):
        fake = _FakeKiwoom(data)
        monkeypatch.setattr(kwc, "KiwoomClient", lambda cfg=None: fake)
        return fake
    return install


FULL_KW = {
    ("foreign", "kospi"): [_kw("005930_AL", "삼성전자", "+500"), _kw("069500", "KODEX 200", "+9999"),
                           _kw("000660", "SK하이닉스", "-30")],
    ("foreign", "kosdaq"): [_kw("A247540", "에코프로비엠", "+400")],
    ("institution", "kospi"): [_kw("000660_AL", "SK하이닉스", "+200"), _kw("005930", "삼성전자", "+100")],
    ("pension", "kospi"): [_kw("005930", "삼성전자", "+70")],
}


def test_kiwoom_not_configured_skips_client(no_krx, monkeypatch):
    monkeypatch.setattr(kwc, "KiwoomClient", lambda *a, **k: pytest.fail("키움 미설정인데 클라이언트 생성"))
    assert inf.fetch_kiwoom(D, session=object()) is None


def test_kiwoom_first_source_shape_unit_suffix_and_filter(with_kiwoom, with_krx, monkeypatch, universe):
    fake = with_kiwoom(FULL_KW)
    pykrx_calls = _install_fake_pykrx(monkeypatch, {})
    out = inf.collect(D, session=object())
    assert set(out) == {"date", "source", "foreign_top", "institution_top", "pension_top", "double_buy"}
    assert out["source"] == "kiwoom" and out["date"] == "2026-10-30"
    # 접미사 제거·ETF(069500, 유니버스 밖) 제외·음수 제외·두 시장 합쳐 정렬·만원→원
    assert [(r["ticker"], r["net_amount"]) for r in out["foreign_top"]] == [("005930", 500.0 * KW),
                                                                            ("247540", 400.0 * KW)]
    assert out["pension_top"] == [{"ticker": "005930", "name": "삼성전자", "net_amount": 70.0 * KW}]
    assert [r["ticker"] for r in out["double_buy"]] == ["005930"]
    assert pykrx_calls == []  # 셋 다 키움으로 찼으면 pykrx 는 부르지 않는다
    assert ("foreign", "20261030", "20261030", "kosdaq", inf.KIWOOM_MAX_PAGES) in fake.calls
    assert len(fake.calls) == 6 and fake.closed


def test_kiwoom_missing_pension_filled_from_pykrx_same_day(with_kiwoom, with_krx, monkeypatch, universe):
    data = dict(FULL_KW)
    data[("pension", "kospi")] = KiwoomApiError(1999, "시간 제한")
    with_kiwoom(data)
    calls = _install_fake_pykrx(monkeypatch, {("KOSPI", "연기금"): _df([("000660", "SK하이닉스", 30)])})
    out = inf.collect(D, session=object())
    assert out["source"] == "kiwoom"  # 외국인·기관이 키움
    assert out["pension_top"] == [{"ticker": "000660", "name": "SK하이닉스", "net_amount": 30.0}]
    assert {c[3] for c in calls} == {"연기금"}  # 빠진 투자자만 pykrx 로


def test_kiwoom_missing_institution_from_pykrx_marks_source_pykrx(with_kiwoom, with_krx, monkeypatch, universe):
    data = {k: v for k, v in FULL_KW.items() if k[0] != "institution"}
    with_kiwoom(data)
    _install_fake_pykrx(monkeypatch, {("KOSPI", "기관합계"): _df([("005930", "삼성전자", 7)])})
    out = inf.collect(D, session=object())
    assert out["source"] == "pykrx"
    assert out["foreign_top"][0]["net_amount"] == 500.0 * KW and out["institution_top"][0]["net_amount"] == 7.0


def test_kiwoom_core_missing_and_no_pykrx_goes_to_kis(with_kiwoom, no_krx, universe):
    with_kiwoom({("foreign", "kospi"): [_kw("005930", "삼성전자", "+5")]})  # 기관 없음, pykrx 없음
    ch = _FakeCH([[(date(2026, 10, 29),)], [("005930", 500, 100)]])
    out = inf.collect(D, ch=ch, session=object())
    assert out["source"] == "kis" and out["date"] == "2026-10-29"  # 날짜가 다른 KIS 와는 섞지 않는다


def test_kiwoom_ip_error_stops_and_falls_to_pykrx(with_kiwoom, with_krx, monkeypatch, universe):
    fake = with_kiwoom({("foreign", "kospi"): KiwoomIpError(8010, "ip")})
    _install_fake_pykrx(monkeypatch, {("KOSPI", "외국인"): _df([("005930", "삼성전자", 5)]),
                                      ("KOSPI", "기관합계"): _df([("005930", "삼성전자", 3)])})
    out = inf.collect(D, session=object())
    assert out["source"] == "pykrx" and len(fake.calls) == 1 and fake.closed  # 남은 5회는 부르지 않음


def test_kiwoom_all_fail_uses_full_pykrx(with_kiwoom, with_krx, monkeypatch, universe):
    with_kiwoom({k: RuntimeError("boom") for k in FULL_KW})
    calls = _install_fake_pykrx(monkeypatch, {("KOSPI", "외국인"): _df([("005930", "삼성전자", 5)])})
    out = inf.collect(D, session=object())
    assert out["source"] == "pykrx" and len(calls) == 6


def test_kiwoom_unit_mismatch_warns(with_kiwoom, no_krx, universe, caplog):
    # 수량×평균가 = 금액(원 단위로 온 경우) → 추정 1 ≠ 설정 → 경고
    row = {"stk_cd": "005930", "stk_nm": "삼성전자", "netslmt_qty": "+10", "netslmt_amt": "+1000",
           "prsm_avg_pric": "100"}
    with_kiwoom({("foreign", "kospi"): [row], ("institution", "kospi"): [row]})
    with caplog.at_level("WARNING"):
        assert inf.fetch_kiwoom(D, session=object())["source"] == "kiwoom"
    assert "금액 단위 추정" in caplog.text

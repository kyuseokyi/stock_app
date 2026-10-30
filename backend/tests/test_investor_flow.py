"""시장 투자자별 순매수 집계 — pykrx(가짜 모듈) 우선, CH investor_daily(KIS) 폴백."""
import sys
import types
from datetime import date

import pandas as pd
import pytest

from apps.collector import investor_flow as inf

D = date(2026, 10, 30)


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

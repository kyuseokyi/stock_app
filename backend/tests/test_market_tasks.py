"""시장 데이터 Celery 태스크 — 투자자 UN→J 폴백, 재무 연간·분기, 공모주 일정, FRED 키 없음, 일일 파이프라인."""
from datetime import date

import pytest
import requests

from apps.collector.kis.master import MasterStock
from apps.collector.tasks import market_data as md
from apps.collector.tasks import universe


class _Client:
    def __init__(self, un_error=False):
        self.calls, self.un_error = [], un_error

    def get_investor_daily(self, ticker, market_code="UN"):
        self.calls.append(("inv", ticker, market_code))
        if market_code == "UN":
            if self.un_error:
                raise requests.HTTPError("KIS rt_cd=1 msg=시장구분 오류")
            return []
        return [{"stck_bsop_date": "20261016", "prsn_ntby_qty": "1", "frgn_ntby_qty": "2", "orgn_ntby_qty": "3",
                 "prsn_ntby_tr_pbmn": "4", "frgn_ntby_tr_pbmn": "5", "orgn_ntby_tr_pbmn": "6"}]

    def get_financial_ratio(self, ticker, period):
        self.calls.append(("fin", ticker, period))
        return [{"stac_yymm": "202606" if period == "1" else "202512", "eps": "100"}]


@pytest.mark.parametrize("un_error", [False, True])
def test_investor_one_falls_back_to_j(monkeypatch, un_error):
    saved = {}

    def _save(t, rows):
        saved[t] = rows
        return len(rows)

    monkeypatch.setattr(md.chm, "upsert_investor_daily", _save)
    c = _Client(un_error=un_error)
    assert md._investor_one("293490", c) == 1
    assert [x[2] for x in c.calls] == ["UN", "J"]
    assert saved["293490"][0]["frgn_qty"] == 2


def test_fundamentals_one_annual_and_quarter(monkeypatch):
    saved = []
    monkeypatch.setattr(md.chm, "upsert_fundamentals",
                        lambda t, p, rows: saved.append((t, p, rows[0]["stac_yymm"])) or 1)
    assert md._fundamentals_one("005930", _Client()) == 2
    assert saved == [("005930", "Y", "202512"), ("005930", "Q", "202606")]


def test_universe_tasks_use_analysis_universe(monkeypatch):
    seen = {}
    monkeypatch.setattr(md, "_analysis_tickers", lambda: [MasterStock("005930", "삼성전자", "KOSPI")])
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda: None)

    def fake_run(collect_one, limit, source, rate, workers=None, tickers=None):
        seen["tickers"] = [t.ticker for t in tickers]
        seen["fn"] = collect_one
        return {"ok": 1}

    monkeypatch.setattr(md, "_run_universe", fake_run)
    assert md.collect_investor_daily() == {"ok": 1}
    assert seen["tickers"] == ["005930"] and seen["fn"] is md._investor_one
    md.collect_fundamentals(limit=1)
    assert seen["fn"] is md._fundamentals_one


def test_run_universe_accepts_explicit_tickers(monkeypatch):
    monkeypatch.setattr(universe, "load_domestic_tickers", lambda source: pytest.fail("마스터를 다시 받으면 안 됨"))
    monkeypatch.setattr(universe, "KISClient", lambda limiter=None: object())
    out = universe._run_universe(lambda t, c: 1, None, None, 1000, workers=1,
                                 tickers=[MasterStock("005930", "삼성전자", "KOSPI")])
    assert out["ok"] == 1 and out["total"] == 1


def test_ipo_events_titles(monkeypatch):
    class C:
        def get_ipo_schedule(self, f, t):
            assert (f, t) == ("20261011", "20261217")
            return [{"sht_cd": "123450", "subscr_dt": "2026.10.27~2026.10.28", "list_dt": "2026.11.05"}]

        def close(self):
            pass

    saved = {}

    def _save(evs):
        saved["evs"] = evs
        return len(evs)

    monkeypatch.setattr(md, "_kis_client", lambda: C())
    monkeypatch.setattr(md, "_names", lambda tickers: {"123450": "신규기업"})
    monkeypatch.setattr(md, "_save_events", _save)
    assert md.collect_ipo_events(today=date(2026, 10, 18)) == {"events": 2}
    assert [(e["title"], e["source_key"], e["category"]) for e in saved["evs"]] == [
        ("신규기업 공모주 청약", "ipo:123450:subscr", "공모주"), ("신규기업 신규 상장", "ipo:123450:listing", "공모주")]


def test_standalone_client_has_rate_limiter(monkeypatch):
    seen = {}
    monkeypatch.setattr(md, "KISClient", lambda limiter=None: seen.setdefault("limiter", limiter))
    md._kis_client()
    assert isinstance(seen["limiter"], md.RateLimiter)  # 지수 첫 백필(연속 호출)도 초당 상한


def test_macro_skips_without_key(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    assert md.collect_macro_series() == {"skipped": "FRED_API_KEY 없음"}


def test_macro_collects_and_isolates(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "k")
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda: None)
    monkeypatch.setattr(md.fred, "series_ids", lambda: ["CPIAUCSL", "DGS10", "BAD"])
    starts = {}
    monkeypatch.setattr(md.chm, "latest_macro_date", lambda s: None)
    monkeypatch.setattr(md.chm, "upsert_macro", lambda s, obs: len(obs))

    class F:
        def __init__(self, key, session=None):
            pass

        def observations(self, sid, start):
            starts[sid] = start
            if sid == "BAD":
                raise RuntimeError("400")
            return [(date(2026, 9, 1), 1.0)]

        def release_of(self, sid):
            assert sid == "CPIAUCSL", "매일 발표(H.15) 시리즈는 발표일을 조회하지 않음"
            return (10, "Consumer Price Index")

        def release_dates(self, rid, start, end):
            return [date(2026, 11, 12)]

    saved = {}

    def _save(evs):
        saved["evs"] = evs
        return len(evs)

    monkeypatch.setattr(md.fred, "FredClient", F)
    monkeypatch.setattr(md, "_save_events", _save)
    out = md.collect_macro_series(today=date(2026, 10, 18))
    assert out["ok"] == ["CPIAUCSL", "DGS10"] and out["failed"][0]["series_id"] == "BAD"
    assert out["inserted"] == 2 and out["events"] == 1
    assert starts["CPIAUCSL"] == date(2024, 10, 18)  # 첫 실행 2년
    assert saved["evs"][0]["title"] == "미국 CPI 발표"


def test_daily_pipeline_continues_after_failure(monkeypatch):
    order = []

    def boom():
        order.append("daily")
        raise RuntimeError("master down")

    monkeypatch.setattr(md, "_daily_ohlcv", boom)
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": order.append(f"idx:{region}") or {"ok": []})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: order.append("investor") or {"ok": 0})
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx:KR", "investor", "canslim"]
    assert "error" in out["daily"] and out["investor"] == {"ok": 0}


def test_beat_schedule_entries():
    from apps.collector.celery_app import celery_app

    beat = celery_app.conf.beat_schedule
    assert beat["collect-all-daily"]["task"] == "collector.daily_market_pipeline"
    assert beat["collect-us-indices"]["kwargs"] == {"region": "US"}
    for key in ("collect-macro-series", "collect-ipo-events", "collect-fundamentals"):
        assert beat[key]["task"].startswith("collector.")
    assert "apps.collector.tasks.market_data" in celery_app.conf.include

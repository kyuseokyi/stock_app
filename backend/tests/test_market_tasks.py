"""시장 데이터 Celery 태스크 — 투자자 UN→J 폴백, 재무 연간·분기, 공모주 일정, FRED 키 없음, 일일 파이프라인."""
from datetime import date, datetime

import fakeredis
import pytest
import requests

from apps.collector import intraday_indices as ii
from apps.collector.kis.master import MasterStock
from apps.collector.tasks import market_data as md
from apps.collector.tasks import universe
from shared import pipeline_record


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
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    order = []

    def boom():
        order.append("daily")
        raise RuntimeError("master down")

    monkeypatch.setattr(md, "_daily_ohlcv", boom)
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": order.append(f"idx:{region}") or {"ok": []})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: order.append("investor") or {"ok": 0})
    monkeypatch.setattr(md, "compute_canslim", lambda: order.append("canslim") or {})
    monkeypatch.setattr(md, "compute_market_groups", lambda: order.append("groups") or {})
    monkeypatch.setattr(md, "compute_screener", lambda: order.append("screener") or {})
    out = md.daily_market_pipeline()
    assert order == ["daily", "idx:KR", "investor", "canslim", "groups", "screener"]
    assert "error" in out["daily"] and out["investor"] == {"ok": 0}


def test_beat_schedule_entries():
    from apps.collector.celery_app import celery_app

    beat = celery_app.conf.beat_schedule
    assert beat["collect-all-daily"]["task"] == "collector.daily_market_pipeline"
    assert beat["collect-us-indices"]["kwargs"] == {"region": "US"}
    for key in ("collect-macro-series", "collect-ipo-events", "collect-fundamentals"):
        assert beat[key]["task"].startswith("collector.")
    assert "apps.collector.tasks.market_data" in celery_app.conf.include
    # 장 마감 시간에 맞춘 지표 갱신(2026-10-20): 국내 지수 15:40 평일, 미국 06:30 + 07:30 안전망(화~토)
    kr = beat["collect-kr-indices"]
    assert kr["task"] == "collector.collect_market_indices" and kr["kwargs"] == {"region": "KR"}
    assert kr["schedule"].hour == {15} and kr["schedule"].minute == {40}
    assert kr["schedule"].day_of_week == {1, 2, 3, 4, 5}
    for key, hour in (("collect-us-indices", 6), ("collect-us-indices-retry", 7)):
        us = beat[key]
        assert us["task"] == "collector.collect_market_indices" and us["kwargs"] == {"region": "US"}
        assert us["schedule"].hour == {hour} and us["schedule"].minute == {30}
        assert us["schedule"].day_of_week == {2, 3, 4, 5, 6}
    # 장중 지수 30초(2026-10-20) — 밀린 실행은 25초 뒤 버림. 끄기는 태스크 안의 env 스위치
    live = beat["poll-intraday-indices"]
    assert live["task"] == "collector.poll_intraday_indices"
    assert live["schedule"] == 30.0 and live["options"] == {"expires": 25}


def _stub_steps(monkeypatch, daily=None):
    monkeypatch.setattr(md, "_daily_ohlcv", daily or (lambda: {"ok": 1}))
    monkeypatch.setattr(md, "collect_market_indices", lambda region="KR": {"ok": ["KOSPI"]})
    monkeypatch.setattr(md, "collect_investor_daily", lambda: {"ok": 3})
    monkeypatch.setattr(md, "compute_canslim", lambda: {"rows": 10})
    monkeypatch.setattr(md, "compute_market_groups", lambda: {"error": "no bars"})
    monkeypatch.setattr(md, "compute_screener", lambda: {"rows": 5})


def test_daily_pipeline_records_steps(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)

    def boom():
        raise RuntimeError("master down")

    _stub_steps(monkeypatch, daily=boom)
    out = md.daily_market_pipeline()
    assert list(out) == ["daily", "indices_kr", "investor", "canslim", "market_groups", "screener"]
    assert out["investor"] == {"ok": 3} and "error" in out["daily"]
    rec = pipeline_record.load(fake)
    assert [s["name"] for s in rec["steps"]] == list(out)
    # 예외로 끝난 단계와 결과에 error 가 담긴 단계는 실패로 기록
    assert [s["ok"] for s in rec["steps"]] == [False, True, True, True, False, True]
    assert "master down" in rec["steps"][0]["summary"]
    assert all(isinstance(s["seconds"], float) and s["seconds"] >= 0 for s in rec["steps"])
    assert rec["started_at"] <= rec["finished_at"]


def test_daily_pipeline_result_unchanged_when_redis_down(monkeypatch):
    class Down:
        def set(self, *a, **k):
            raise ConnectionError("redis down")

    monkeypatch.setattr(md, "get_sync_redis", lambda: Down())
    _stub_steps(monkeypatch)
    out = md.daily_market_pipeline()
    assert out == {"daily": {"ok": 1}, "indices_kr": {"ok": ["KOSPI"]}, "investor": {"ok": 3},
                   "canslim": {"rows": 10}, "market_groups": {"error": "no bars"}, "screener": {"rows": 5}}


def test_daily_pipeline_result_unchanged_when_redis_client_fails(monkeypatch):
    def bad_client():
        raise ValueError("bad url")

    monkeypatch.setattr(md, "get_sync_redis", bad_client)
    _stub_steps(monkeypatch)
    out = md.daily_market_pipeline()
    assert out == {"daily": {"ok": 1}, "indices_kr": {"ok": ["KOSPI"]}, "investor": {"ok": 3},
                   "canslim": {"rows": 10}, "market_groups": {"error": "no bars"}, "screener": {"rows": 5}}


def test_ipo_title_uses_response_name_when_master_missing(monkeypatch):
    class C:
        def get_ipo_schedule(self, f, t):
            return [{"sht_cd": "123450", "isin_name": "신규기업", "subscr_dt": "20261027"},
                    {"sht_cd": "999990", "subscr_dt": "20261028"}]

        def close(self):
            pass

    saved = {}
    monkeypatch.setattr(md, "_kis_client", lambda: C())
    monkeypatch.setattr(md, "_names", lambda tickers: {})  # 마스터에 없음(상장 전)
    monkeypatch.setattr(md, "_save_events", lambda evs: saved.setdefault("evs", evs) and len(evs))
    md.collect_ipo_events(today=date(2026, 10, 18))
    assert [e["title"] for e in saved["evs"]] == ["신규기업 공모주 청약", "999990 공모주 청약"]


class _IntradayClient:
    def __init__(self):
        self.closed = False

    def get_domestic_index_daily(self, code, s, e):
        return [{"stck_bsop_date": s, "bstp_nmix_prpr": "2601.5"}]

    def get_overseas_daily(self, mrkt, symbol, s, e):
        return [{"stck_bsop_date": s, "ovrs_nmix_prpr": "1385.2"}]

    def close(self):
        self.closed = True


def _no_kis(*a, **k):
    raise AssertionError("장 밖·꺼짐에서는 KIS 클라이언트를 만들면 안 된다")


def test_poll_intraday_skips_without_kis(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.setattr(md, "KISClient", _no_kis)
    monkeypatch.setenv("INTRADAY_INDICES_ENABLED", "false")
    assert md.poll_intraday_indices() == {"skipped": "disabled"}
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED")
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 17, 10, 0, tzinfo=ii.KST))  # 토요일
    assert md.poll_intraday_indices() == {"skipped": "closed"}
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 15, 35, tzinfo=ii.KST))  # 장 끝
    assert md.poll_intraday_indices() == {"skipped": "closed"}


def test_poll_intraday_runs_in_window(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)
    fake = fakeredis.FakeRedis(decode_responses=True)
    made = {}

    def make_client(limiter=None):
        made["limiter"], made["client"] = limiter, _IntradayClient()
        return made["client"]

    monkeypatch.setattr(md, "KISClient", make_client)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 14, 32, tzinfo=ii.KST))
    out = md.poll_intraday_indices()
    assert out["ok"] == sorted(ii.INTRADAY_CODES) and out["failed"] == []
    assert made["limiter"]._min_interval == pytest.approx(1 / ii.INTRADAY_RATE)  # 전용 초당 2건
    assert made["client"].closed is True
    assert fake.get(ii.INTRADAY_KEY) is not None


def test_poll_intraday_logs_kis_setup_error(monkeypatch):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)

    def no_creds(limiter=None):
        raise RuntimeError("KIS 자격증명 없음")

    monkeypatch.setattr(md, "KISClient", no_creds)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fakeredis.FakeRedis(decode_responses=True))
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 10, 0, tzinfo=ii.KST))
    out = md.poll_intraday_indices()
    assert "KIS 자격증명 없음" in out["error"]


# ---- 중복 실행 잠금·시간 제한
def _open_window(monkeypatch, fake):
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    monkeypatch.delenv("INTRADAY_INDICES_ENABLED", raising=False)
    monkeypatch.setattr(md, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(md.intraday, "now_kst", lambda: datetime(2026, 10, 20, 14, 32, tzinfo=ii.KST))


def test_poll_intraday_busy_when_locked(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    _open_window(monkeypatch, fake)
    fake.set(ii.INTRADAY_LOCK_KEY, "other", ex=60)
    monkeypatch.setattr(md, "KISClient", _no_kis)  # 잠겨 있으면 클라이언트를 만들지 않는다
    assert md.poll_intraday_indices() == {"skipped": "busy"}
    assert fake.get(ii.INTRADAY_LOCK_KEY) == "other"  # 남의 잠금은 그대로


def test_poll_intraday_releases_lock_after_run(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    _open_window(monkeypatch, fake)
    seen = {}

    def make_client(limiter=None):
        seen["ttl"] = fake.ttl(ii.INTRADAY_LOCK_KEY)  # 실행 중에는 잠겨 있다
        return _IntradayClient()

    monkeypatch.setattr(md, "KISClient", make_client)
    out = md.poll_intraday_indices()
    assert out["failed"] == [] and 0 < seen["ttl"] <= ii.INTRADAY_LOCK_TTL
    assert fake.get(ii.INTRADAY_LOCK_KEY) is None


def test_poll_intraday_releases_lock_on_error(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    _open_window(monkeypatch, fake)

    def boom(limiter=None):
        raise RuntimeError("KIS 장애")

    monkeypatch.setattr(md, "KISClient", boom)
    assert "KIS 장애" in md.poll_intraday_indices()["error"]
    assert fake.get(ii.INTRADAY_LOCK_KEY) is None


def test_poll_intraday_releases_lock_on_soft_time_limit(monkeypatch):
    from celery.exceptions import SoftTimeLimitExceeded

    fake = fakeredis.FakeRedis(decode_responses=True)
    _open_window(monkeypatch, fake)

    def slow(limiter=None):
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr(md, "KISClient", slow)
    assert "error" in md.poll_intraday_indices()
    assert fake.get(ii.INTRADAY_LOCK_KEY) is None


def test_poll_intraday_does_not_delete_foreign_lock(monkeypatch):
    # 내 실행이 길어져 잠금이 만료되고 다른 실행이 새로 잡았다면 그 잠금을 지우면 안 된다
    fake = fakeredis.FakeRedis(decode_responses=True)
    _open_window(monkeypatch, fake)

    def make_client(limiter=None):
        fake.set(ii.INTRADAY_LOCK_KEY, "someone-else", ex=60)  # 내 잠금이 사라지고 남이 잡음
        return _IntradayClient()

    monkeypatch.setattr(md, "KISClient", make_client)
    md.poll_intraday_indices()
    assert fake.get(ii.INTRADAY_LOCK_KEY) == "someone-else"


def test_poll_intraday_time_limits_shorter_than_lock_ttl():
    t = md.poll_intraday_indices
    assert t.soft_time_limit == 40 and t.time_limit == 50
    assert t.time_limit < ii.INTRADAY_LOCK_TTL

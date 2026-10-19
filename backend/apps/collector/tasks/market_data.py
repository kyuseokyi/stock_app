"""시장 데이터 수집 Celery 태스크 — 지수·투자자별 순매수·재무비율·공모주 일정·FRED 거시 지표.

일봉(20:30) 뒤 국내 지수·투자자 수집은 daily_market_pipeline 이 같은 작업 안에서 차례로 돌린다
(KIS 초당 상한을 두 작업이 동시에 나눠 쓰지 않게, 앞 단계 예외와 무관하게 다음 단계 진행).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import requests

from apps.collector import fred
from apps.collector import market_parsers as mp
from apps.collector.celery_app import celery_app
from apps.collector.kis.client import KRX_MARKET_CODE, KISClient
from apps.collector.kis.master import MasterStock
from apps.collector.market_indices import collect_indices, index_specs
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.rate_limit import RateLimiter
from apps.collector.tasks.canslim import compute_canslim
from apps.collector.tasks.market_groups import compute_market_groups
from apps.collector.tasks.universe import _DEFAULT_RATE, _run_universe, collect_all_daily
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)
IPO_BACK_DAYS = 7
IPO_AHEAD_DAYS = 60
MACRO_BACKFILL_DAYS = 730
MACRO_OVERLAP_DAYS = 90  # 수정 발표(revision)까지 다시 받기
RELEASE_AHEAD_DAYS = 60


def _kis_client():
    """단독 태스크용 클라이언트 — 지수 첫 백필은 연속 호출이 많아 같은 초당 상한(_DEFAULT_RATE)을 건다."""
    return KISClient(limiter=RateLimiter(_DEFAULT_RATE))


def _analysis_tickers() -> list[MasterStock]:
    with SyncSessionLocal() as db:
        return [MasterStock(t, n, m) for t, n, m in market_repo.analysis_universe(db)]


def _names(tickers: list[str]) -> dict[str, str]:
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def _save_events(events: list[dict]) -> int:
    with SyncSessionLocal() as db:
        return market_repo.upsert_events(db, events)


# ---------------------------------------------------------------- 지수
@celery_app.task(name="collector.collect_market_indices")
def collect_market_indices(region: str = "KR") -> dict:
    """region: KR(국내 지수, 일봉 뒤) | US(미국 지수·환율·대표 종목, 07:30)."""
    chm.ensure_market_tables()
    client = _kis_client()
    try:
        return collect_indices(index_specs(region), client)
    finally:
        client.close()


# ---------------------------------------------------------------- 투자자별 순매수
def _investor_one(ticker: str, client) -> int:
    try:
        raw = client.get_investor_daily(ticker, market_code="UN")
    except requests.HTTPError:  # UN 미지원(rt_cd·4xx) — 연결계열(KISConnectionError)은 그대로 올려 쿨다운
        raw = []
    if not raw:  # NXT 미상장 종목 등 — KRX(J) 폴백
        raw = client.get_investor_daily(ticker, market_code=KRX_MARKET_CODE)
    return chm.upsert_investor_daily(ticker, mp.parse_investor(raw))


@celery_app.task(name="collector.collect_investor_daily")
def collect_investor_daily(limit: int | None = None, rate_per_sec: float | None = None,
                           workers: int | None = None) -> dict:
    """분석 대상 종목(보통주)의 최근 약 30거래일 개인·외국인·기관 순매수 — 매일 겹쳐 받아 누적."""
    chm.ensure_market_tables()
    return _run_universe(_investor_one, limit, None, rate_per_sec, workers, tickers=_analysis_tickers())


# ---------------------------------------------------------------- 재무비율
def _fundamentals_one(ticker: str, client) -> int:
    n = 0
    for period, code in (("Y", "0"), ("Q", "1")):
        n += chm.upsert_fundamentals(ticker, period, mp.parse_financial_ratio(client.get_financial_ratio(ticker, code)))
    return n


@celery_app.task(name="collector.collect_fundamentals")
def collect_fundamentals(limit: int | None = None, rate_per_sec: float | None = None,
                         workers: int | None = None) -> dict:
    """연간·분기 재무비율(EPS·ROE 등). 매주 토 + 수동. 분기 EPS 누적 여부는 원값 그대로 저장(해석은 분석 단계)."""
    chm.ensure_market_tables()
    return _run_universe(_fundamentals_one, limit, None, rate_per_sec, workers, tickers=_analysis_tickers())


# ---------------------------------------------------------------- 공모주 일정
@celery_app.task(name="collector.collect_ipo_events")
def collect_ipo_events(today: date | None = None) -> dict:
    today = today or date.today()
    client = _kis_client()
    try:
        rows = client.get_ipo_schedule((today - timedelta(days=IPO_BACK_DAYS)).strftime("%Y%m%d"),
                                       (today + timedelta(days=IPO_AHEAD_DAYS)).strftime("%Y%m%d"))
    finally:
        client.close()
    parsed = mp.parse_ipo(rows)
    names = _names(sorted({e["ticker"] for e in parsed}))
    label = {"subscr": "공모주 청약", "listing": "신규 상장"}
    events = [{"event_date": e["event_date"], "title": f"{names.get(e['ticker'], e['ticker'])} {label[e['kind']]}",
               "category": "공모주", "ticker": e["ticker"], "source": "kis",
               "source_key": f"ipo:{e['ticker']}:{e['kind']}", "payload": e["payload"]} for e in parsed]
    n = _save_events(events) if events else 0
    log.info("공모주 일정: %d건", n)
    return {"events": n}


# ---------------------------------------------------------------- FRED
@celery_app.task(name="collector.collect_macro_series")
def collect_macro_series(today: date | None = None) -> dict:
    key = fred.api_key()
    if key is None:
        log.info("FRED_API_KEY 없음 — 거시 지표 수집 건너뜀")
        return {"skipped": "FRED_API_KEY 없음"}
    today = today or date.today()
    chm.ensure_market_tables()
    client = fred.FredClient(key)
    ok, failed, inserted = [], [], 0
    releases: dict[int, tuple[str, str]] = {}
    for sid in fred.series_ids():
        try:
            latest = chm.latest_macro_date(sid)
            start = (today - timedelta(days=MACRO_BACKFILL_DAYS) if latest is None
                     else latest - timedelta(days=MACRO_OVERLAP_DAYS))
            inserted += chm.upsert_macro(sid, client.observations(sid, start))
            if sid in fred.CALENDAR_SERIES:  # 금리·스프레드(H.15 등)는 매 영업일 발표라 캘린더에 넣지 않음
                rel = client.release_of(sid)
                if rel is not None and rel[0] not in releases:
                    releases[rel[0]] = (rel[1], sid)
            ok.append(sid)
        except Exception as e:  # noqa: BLE001 — 시리즈 하나 실패가 나머지를 막지 않게
            log.warning("FRED 수집 실패 %s: %s", sid, str(e)[:160])
            failed.append({"series_id": sid, "error": repr(e)[:300]})
    dates = {}
    for rid in releases:
        try:
            dates[rid] = client.release_dates(rid, today, today + timedelta(days=RELEASE_AHEAD_DAYS))
        except Exception as e:  # noqa: BLE001
            log.warning("FRED 발표일 조회 실패 release=%s: %s", rid, str(e)[:160])
    events = fred.release_events(releases, dates)
    n_events = _save_events(events) if events else 0
    log.info("FRED 수집: ok=%d failed=%d inserted=%d events=%d", len(ok), len(failed), inserted, n_events)
    return {"ok": ok, "failed": failed, "inserted": inserted, "events": n_events}


# ---------------------------------------------------------------- 일일 파이프라인
def _daily_ohlcv() -> dict:
    return collect_all_daily()


@celery_app.task(name="collector.daily_market_pipeline")
def daily_market_pipeline() -> dict:
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → CANSLIM → 시장 그룹(차례로, 앞 단계 예외와 무관하게 진행)."""
    out: dict = {}
    steps = (("daily", _daily_ohlcv), ("indices_kr", lambda: collect_market_indices("KR")),
             ("investor", lambda: collect_investor_daily()), ("canslim", lambda: compute_canslim()),
             ("market_groups", lambda: compute_market_groups()))
    for name, step in steps:
        try:
            out[name] = step()
        except Exception as e:  # noqa: BLE001
            log.exception("일일 파이프라인 단계 실패: %s", name)
            out[name] = {"error": repr(e)[:300]}
    return out

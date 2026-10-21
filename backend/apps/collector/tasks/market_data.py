"""시장 데이터 수집 Celery 태스크 — 지수·투자자별 순매수·재무비율·공모주 일정·FRED 거시 지표.

일봉(20:30) 뒤 국내 지수·투자자 수집은 daily_market_pipeline 이 같은 작업 안에서 차례로 돌린다
(KIS 초당 상한을 두 작업이 동시에 나눠 쓰지 않게, 앞 단계 예외와 무관하게 다음 단계 진행).
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import requests

from apps.collector import fred
from apps.collector import intraday_indices as intraday
from apps.collector import market_parsers as mp
from apps.collector.celery_app import celery_app
from apps.collector.kis.client import KRX_MARKET_CODE, KISClient
from apps.collector.kis.master import MasterStock
from apps.collector.market_indices import collect_indices, index_specs
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.rate_limit import RateLimiter
from apps.collector.tasks.canslim import compute_canslim
from apps.collector.tasks.market_groups import compute_market_groups
from apps.collector.tasks.screener import compute_screener
from apps.collector.tasks.universe import _DEFAULT_RATE, _run_universe, collect_all_daily
from shared import market_repo, pipeline_record
from shared.sync_redis import get_sync_redis
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


# ---------------------------------------------------------------- 장중 지수(30초)
def _release_lock(redis, token: str) -> None:
    """내 토큰일 때만 잠금 해제. Lua 대신 get 비교 후 delete — 단순한 쪽을 택했다. 비교와 삭제 사이에
    만료+재획득이 끼면 남의 잠금을 지울 수 있으나, 그 틈은 마이크로초이고 결과도 다음 30초 한 번 중복 실행일 뿐이다."""
    try:
        if redis.get(intraday.INTRADAY_LOCK_KEY) == token:
            redis.delete(intraday.INTRADAY_LOCK_KEY)
    except Exception as e:  # noqa: BLE001 — 해제 실패는 60초 뒤 만료로 풀린다
        log.warning("장중 지수 잠금 해제 실패: %s", str(e)[:160])


# ignore_result — 30초마다 돌아 결과를 Redis 결과 백엔드에 남기면 하루 2,880건이 쌓인다(아무도 읽지 않음)
# 시간 제한 — KISClient 는 재시도·백오프로 4건이면 최대 약 6분이라, 제한이 없으면 장애 때 워커를 오래 붙잡는다.
# 잠금 만료(INTRADAY_LOCK_TTL=60)보다 짧게 둔다. KIS 클라이언트 재시도 설정은 다른 수집에 쓰이므로 건드리지 않는다.
@celery_app.task(name="collector.poll_intraday_indices", ignore_result=True, soft_time_limit=40, time_limit=50)
def poll_intraday_indices() -> dict:
    """장중 국내 지수 3개·원/달러 → Redis market:intraday(30초 beat). 꺼짐·장 밖이면 KIS 를 부르지 않고 바로 끝.

    순서: env 스위치 → 거래일·시간 → (그때만) KIS 클라이언트 생성. 클라이언트 생성은 자격증명·Redis·세션을
    쓰므로 장 밖 30초마다 만들지 않는다. KIS·Redis 장애는 로그만 남기고 다음 주기에 다시 시도한다.
    """
    if not intraday.enabled():
        return {"skipped": "disabled"}
    now = intraday.now_kst()  # 시간대 있는(aware) 시각 — naive 는 in_intraday_window·poll 이 거부한다
    if not intraday.in_intraday_window(now):
        return {"skipped": "closed"}
    client = None
    redis = None
    token = uuid.uuid4().hex
    locked = False
    try:
        redis = get_sync_redis()
        # 중복 실행 잠금(KIS 클라이언트 생성 전) — 앞 실행이 아직 돌면 바로 끝낸다
        if not redis.set(intraday.INTRADAY_LOCK_KEY, token, nx=True, ex=intraday.INTRADAY_LOCK_TTL):
            return {"skipped": "busy"}
        locked = True
        client = KISClient(limiter=RateLimiter(intraday.INTRADAY_RATE))
        return intraday.poll(client, redis, now)
    except Exception as e:  # noqa: BLE001 — 장중 갱신 실패가 워커를 흔들지 않게(화면은 확정 종가로). 시간 제한 예외 포함
        log.warning("장중 지수 갱신 실패: %s", str(e)[:200])
        return {"error": repr(e)[:300]}
    finally:
        if client is not None:
            client.close()
        if locked:
            _release_lock(redis, token)


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
    # 이름: 응답의 종목명(상장 전 공모주) → 종목 마스터 → 티커
    events = [{"event_date": e["event_date"],
               "title": f"{e.get('name') or names.get(e['ticker']) or e['ticker']} {label[e['kind']]}",
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
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → CANSLIM → 시장 그룹 → 스크리너(차례로, 앞 단계 예외와 무관하게 진행).

    끝나면 단계별 성공·걸린 시간·요약을 Redis 에 남긴다(관리자 데이터 현황). 기록 실패는 결과에 영향 없음.
    """
    out: dict = {}
    record: list[dict] = []
    started = datetime.now(timezone.utc)
    steps = (("daily", _daily_ohlcv), ("indices_kr", lambda: collect_market_indices("KR")),
             ("investor", lambda: collect_investor_daily()), ("canslim", lambda: compute_canslim()),
             ("market_groups", lambda: compute_market_groups()), ("screener", lambda: compute_screener()))
    for name, step in steps:
        t0 = time.monotonic()
        try:
            out[name] = step()
        except Exception as e:  # noqa: BLE001
            log.exception("일일 파이프라인 단계 실패: %s", name)
            out[name] = {"error": repr(e)[:300]}
        result = out[name]
        record.append({"name": name, "ok": not (isinstance(result, dict) and "error" in result),
                       "seconds": round(time.monotonic() - t0, 1), "summary": pipeline_record.summarize(result)})
    try:
        pipeline_record.save(get_sync_redis(), started, datetime.now(timezone.utc), record)
    except Exception as exc:  # noqa: BLE001 — 기록 실패가 파이프라인 결과를 막지 않게
        log.warning("파이프라인 기록 저장 실패: %s", exc)
    return out

"""시장 데이터 수집 Celery 태스크 — 지수·투자자별 순매수·대차잔고(키움)·테마 스냅숏(키움)·재무비율·공모주 일정·FRED 거시 지표.

일봉(20:30) 뒤 국내 지수·투자자 수집은 daily_market_pipeline 이 같은 작업 안에서 차례로 돌린다
(KIS 초당 상한을 두 작업이 동시에 나눠 쓰지 않게, 앞 단계 예외와 무관하게 다음 단계 진행).
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone

import requests

from apps.collector import ecos
from apps.collector import fred
from apps.collector import investor_detail as idt
from apps.collector import trading_day
from apps.collector import intraday_indices as intraday
from apps.collector import market_parsers as mp
from apps.collector.celery_app import celery_app
from apps.collector.kis.client import KRX_MARKET_CODE, KISClient
from apps.collector.kis.master import MasterStock
from apps.collector.kiwoom import lending as kiwoom_lending
from apps.collector.kiwoom import themes as kiwoom_themes
from apps.collector.market_indices import collect_indices, index_specs
from apps.collector.stock_master import load_domestic_tickers
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.rate_limit import RateLimiter
from apps.collector.tasks.canslim import compute_canslim
from apps.collector.tasks.featured import compute_featured_highs
from apps.collector.tasks.market_groups import compute_market_groups
from apps.collector.tasks.patterns import compute_patterns
from apps.collector.tasks.screener import compute_screener
from apps.collector.tasks.universe import _DEFAULT_RATE, _run_universe, collect_all_daily
from shared import market_repo, pipeline_record
from shared.kiwoom_config import get_kiwoom_config
from shared.sync_redis import get_sync_redis
from shared.database import SyncSessionLocal
from shared.clickhouse_schema import get_local_client, local_client_configured, market_data_readonly, readonly_skip

log = logging.getLogger(__name__)
IPO_BACK_DAYS = 7
IPO_AHEAD_DAYS = 60
MACRO_BACKFILL_DAYS = 730
MACRO_OVERLAP_DAYS = 90  # 수정 발표(revision)까지 다시 받기
RELEASE_AHEAD_DAYS = 60
# ECOS 원/달러 — 첫 수집은 약 1년 4개월(직전 값·추이 비교용), 이후 30일 겹침(늦게 올라온 날·정정 반영, ReplacingMergeTree 라 멱등)
ECOS_BACKFILL_DAYS = 400
ECOS_OVERLAP_DAYS = 30
# 세부 투자자 매일 수집 겹침(거래일) — 하루 실패로 빠진 날이 구멍으로 남으면 연속 일수가 끊겨 10거래일 동안 프리셋에서
# 빠진다. 한 호출이 5거래일 이상을 주면 추가 호출 없음, 하루씩만 주면 종목당 최대 5장(명세 확인 필요 — 실측 후 조정).
DETAIL_DAILY_DAYS = 5
DETAIL_BACKFILL_DAYS = 30  # 첫 실행·수동 백필 — 연기금 10일 연속 판정에 넉넉히
# KIS FHPTJ04160001 은 KST 00:00~15:40 조회 불가(rt_cd=2 'TIME LIMIT 00:00 ~ 15:40', 2026-11-16 상용 실측).
# 그 시간엔 호출하지 않고 바로 건너뛴다 — 전종목 2,672회를 헛되이 부르지 않게. 20:30 정기 수집은 영향 없음.
DETAIL_OPEN_AFTER = dtime(15, 40)
DETAIL_TIME_LIMIT_MSG = "KIS 세부 수급은 15:40 이후에만 조회돼요 — 15:40 이후 다시 실행하세요"
# 대차잔고(키움 ka20068) — 매일 최근 5거래일 겹침, 수동 백필 60거래일. 매일 단계는 자동 장기 백필을 하지 않는다.
LENDING_DAILY_DAYS = 5
LENDING_BACKFILL_DAYS = 60
LENDING_NOT_CONFIGURED = "키움 키 없음"


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
    if (skip := readonly_skip("collector.collect_market_indices")) is not None:
        return skip
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
    if (skip := readonly_skip("collector.collect_investor_daily")) is not None:
        return skip
    chm.ensure_market_tables()
    return _run_universe(_investor_one, limit, None, rate_per_sec, workers, tickers=_analysis_tickers())


# ---------------------------------------------------------------- 세부 투자자(연기금 등) 순매수
def _investor_detail_one(ticker: str, client, end: date, days: int) -> int:
    return chm.upsert_investor_detail_daily(ticker, idt.fetch_investor_detail(client, ticker, end, days))


@celery_app.task(name="collector.collect_investor_detail_daily")
def collect_investor_detail_daily(limit: int | None = None, rate_per_sec: float | None = None,
                                  workers: int | None = None, days: int | None = None,
                                  end: str | None = None) -> dict:
    """분석 대상 종목(보통주 — investor 단계와 같은 대상)의 연기금·사모·투신·은행·보험·기타금융 순매수.

    days 를 안 주면 DETAIL_DAILY_DAYS — 매일 20:30 단계는 테이블이 비어 있어도 30거래일 백필을 하지 않는다
    (하루 1행씩 주는 TR 이면 1시간 넘게 걸려 뒤 단계 canslim·screener 가 밀린다). 30거래일은 수동 백필
    `collector.backfill_investor_detail` 또는 관리자 '초기 데이터 준비'로 낮 시간에 채운다.
    end: 기준일(YYYYMMDD·YYYY-MM-DD, 기본 오늘 KST). 공유 RateLimiter 는 _run_universe 가 건다.
    """
    if (skip := readonly_skip("collector.collect_investor_detail_daily")) is not None:
        return skip
    if trading_day.now_kst().time() < DETAIL_OPEN_AFTER:
        log.warning("세부 수급 건너뜀: %s", DETAIL_TIME_LIMIT_MSG)
        return {"skipped": DETAIL_TIME_LIMIT_MSG}
    chm.ensure_market_tables()
    if days is None:
        days = DETAIL_DAILY_DAYS
    d_end = idt.to_date(end, trading_day.now_kst().date())
    n_days = max(1, int(days))
    out = _run_universe(lambda t, c: _investor_detail_one(t, c, d_end, n_days), limit, None, rate_per_sec, workers,
                        tickers=_analysis_tickers())
    if isinstance(out, dict):
        out = {**out, "days": n_days, "end": d_end.isoformat()}
    return out


@celery_app.task(name="collector.backfill_investor_detail")
def backfill_investor_detail(days: int = DETAIL_BACKFILL_DAYS, end: str | None = None, limit: int | None = None,
                             rate_per_sec: float | None = None, workers: int | None = None) -> dict:
    """수동 백필 — 최근 days 거래일(기본 30). 다시 돌려도 멱등(FINAL 기준 날짜당 1행)."""
    return collect_investor_detail_daily(limit=limit, rate_per_sec=rate_per_sec, workers=workers, days=days, end=end)


# ---------------------------------------------------------------- 대차잔고(키움 ka20068)
def _kiwoom_client():
    from apps.collector.kiwoom.client import KiwoomClient  # 키 없을 때 requests·redis 세션을 만들지 않게 지연 import

    return KiwoomClient(get_kiwoom_config())


@celery_app.task(name="collector.collect_lending_daily")
def collect_lending_daily(days: int | None = None, end: str | None = None, limit: int | None = None) -> dict:
    """분석 대상 종목(보통주 — investor 단계와 같은 대상)의 대차잔고 추이(키움 ka20068).

    키움 키가 없으면(개발 서버) CH·PG·키움을 건드리지 않고 `{"skipped": "키움 키 없음"}`.
    days: 거래일 수(기본 LENDING_DAILY_DAYS=5, 달력일로는 kiwoom_lending.calendar_start), end: 기준일(기본 오늘 KST).
    초당 상한은 KiwoomClient 의 RateLimiter(KIWOOM_RATE_PER_SEC).
    """
    if (skip := readonly_skip("collector.collect_lending_daily")) is not None:
        return skip
    if not get_kiwoom_config().is_configured:
        log.info("대차잔고 수집 건너뜀: %s", LENDING_NOT_CONFIGURED)
        return {"skipped": LENDING_NOT_CONFIGURED}
    chm.ensure_market_tables()
    n_days = max(1, int(days if days is not None else LENDING_DAILY_DAYS))
    d_end = idt.to_date(end, trading_day.now_kst().date())
    start = kiwoom_lending.calendar_start(d_end, n_days)
    tickers = [s.ticker for s in _analysis_tickers()]
    if limit:
        tickers = tickers[: int(limit)]
    out = kiwoom_lending.run_lending(tickers, start, d_end, client_factory=_kiwoom_client,
                                     store=chm.upsert_lending_daily)
    return {**out, "days": n_days} if isinstance(out, dict) and "skipped" not in out else out


@celery_app.task(name="collector.backfill_lending")
def backfill_lending(days: int = LENDING_BACKFILL_DAYS, end: str | None = None, limit: int | None = None) -> dict:
    """수동 백필 — 최근 days 거래일(기본 60). 다시 돌려도 멱등(FINAL 기준 날짜당 1행). 키움 키 없으면 skipped."""
    return collect_lending_daily(days=days, end=end, limit=limit)


# ---------------------------------------------------------------- 테마(키움 ka90001·ka90002)
def _store_kiwoom_themes(rows, keep_codes) -> dict:
    with SyncSessionLocal() as db:
        return market_repo.sync_kiwoom_themes(db, rows, keep_codes)


@celery_app.task(name="collector.collect_themes_kiwoom")
def collect_themes_kiwoom() -> dict:
    """키움 테마 스냅숏(테마 목록 + 테마별 구성 종목) 교체 — 시장 그룹 계산 앞. 실패하면 지난 스냅숏 유지.

    키움 키가 없으면(개발 서버) PG·키움을 건드리지 않고 `{"skipped": "키움 키 없음"}` — 테마는 KIS 마스터로 계산된다.
    """
    if not get_kiwoom_config().is_configured:
        log.info("키움 테마 수집 건너뜀: %s", LENDING_NOT_CONFIGURED)
        return {"skipped": LENDING_NOT_CONFIGURED}
    return kiwoom_themes.run_themes(client_factory=_kiwoom_client, store=_store_kiwoom_themes)


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
    if (skip := readonly_skip("collector.collect_fundamentals")) is not None:
        return skip
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
    # macro_series 쓰기는 개발 자체 CH 로(CLICKHOUSE_LOCAL_* 설정 시 — prod_readonly 에서도 FRED·발표 일정은 계속, Q3).
    # 설정이 없으면 인자를 넘기지 않아 지금과 같은 호출이다.
    ch = {"client": get_local_client()} if local_client_configured() else {}
    chm.ensure_market_tables(**ch)
    client = fred.FredClient(key)
    ok, failed, inserted = [], [], 0
    releases: dict[int, tuple[str, str]] = {}
    for sid in fred.series_ids():
        try:
            latest = chm.latest_macro_date(sid, **ch)
            start = (today - timedelta(days=MACRO_BACKFILL_DAYS) if latest is None
                     else latest - timedelta(days=MACRO_OVERLAP_DAYS))
            inserted += chm.upsert_macro(sid, client.observations(sid, start), **ch)
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


# ---------------------------------------------------------------- ECOS(한국은행) 원/달러
@celery_app.task(name="collector.collect_ecos_usdkrw")
def collect_ecos_usdkrw(today: date | None = None) -> dict:
    """원/달러 매매기준율(ECOS 731Y001/0000001, 일별) → macro_series(series_id=ECOS:USDKRW).

    시세 비노출(A안)에서도 보여 줄 수 있는 공공 통계라 홈 '오늘 시장 참고'·거시 목록에 쓴다.
    쓰기 위치는 FRED 와 같다: CLICKHOUSE_LOCAL_* 가 있으면 개발 자체 CH, 없으면 기본 CH.
    단 prod_readonly 인데 로컬 CH 설정이 없으면 기본 CH = 상용(읽기 전용 계정)이므로 쓰지 않고 건너뛴다.
    키가 URL 에 들어가므로 실패는 EcosError 문장(키 없음)이나 예외 종류 이름만 남긴다.
    """
    key = ecos.api_key()
    if key is None:
        log.info("ECOS_API_KEY 없음 — 원/달러(ECOS) 수집 건너뜀")
        return {"skipped": "ECOS_API_KEY 없음"}
    if market_data_readonly() and not local_client_configured():
        return readonly_skip("collector.collect_ecos_usdkrw")
    today = today or date.today()
    ch = {"client": get_local_client()} if local_client_configured() else {}
    sid = ecos.SERIES_ID
    try:
        chm.ensure_market_tables(**ch)
        latest = chm.latest_macro_date(sid, **ch)
        start = (today - timedelta(days=ECOS_BACKFILL_DAYS) if latest is None
                 else latest - timedelta(days=ECOS_OVERLAP_DAYS))
        rows = ecos.EcosClient(key).usdkrw_daily(start, today)
        inserted = chm.upsert_macro(sid, rows, **ch)
    except ecos.EcosError as e:
        log.warning("ECOS 원/달러 수집 실패: %s", e)
        return {"series_id": sid, "inserted": 0, "error": str(e)}
    except Exception as e:  # noqa: BLE001 — CH 오류 등. 원문에 키가 섞일 수 있어 종류만 남긴다
        log.warning("ECOS 원/달러 수집 실패: %s", type(e).__name__)
        return {"series_id": sid, "inserted": 0, "error": type(e).__name__}
    last = next((d for d, v in reversed(rows) if v is not None), None)
    log.info("ECOS 원/달러 수집: inserted=%d latest=%s", inserted, last)
    return {"series_id": sid, "inserted": inserted, "latest": last.isoformat() if last else None}


# ---------------------------------------------------------------- 일일 파이프라인
def _daily_ohlcv() -> dict:
    return collect_all_daily()


@celery_app.task(name="collector.daily_market_pipeline")
def daily_market_pipeline() -> dict:
    """20:30 — 전종목 일봉 → 국내 지수 → 투자자별 순매수 → 세부 투자자(연기금 등) → 대차잔고(키움, 키 없으면 skipped) → CANSLIM → 테마(키움, 키 없으면 skipped) → 시장 그룹 → 스크리너 → 차트 패턴 → 신고저가(오늘 특징주)(차례로, 앞 단계 예외와 무관하게 진행).

    끝나면 단계별 성공·걸린 시간·요약을 Redis 에 남긴다(관리자 데이터 현황). 기록 실패는 결과에 영향 없음.
    """
    if (skip := readonly_skip("collector.daily_market_pipeline")) is not None:
        return skip
    out: dict = {}
    record: list[dict] = []
    started = datetime.now(timezone.utc)
    steps = (("daily", _daily_ohlcv), ("indices_kr", lambda: collect_market_indices("KR")),
             ("investor", lambda: collect_investor_daily()),
             ("investor_detail", lambda: collect_investor_detail_daily()),
             ("lending", lambda: collect_lending_daily()), ("canslim", lambda: compute_canslim()),
             ("themes_kiwoom", lambda: collect_themes_kiwoom()),
             ("market_groups", lambda: compute_market_groups()), ("screener", lambda: compute_screener()),
             ("patterns", lambda: compute_patterns()), ("featured_highs", lambda: compute_featured_highs()))
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


# ---------------------------------------------------------------- 개발 경량 파이프라인(prod_readonly 전용)
def _sync_master() -> dict:
    """종목 마스터만 동기화 — .mst 파일 다운로드(KIS 시세 API·쿼터와 무관) → PG stock_meta·프로필·업종·테마. CH 쓰기 없음."""
    return {"active": len(load_domestic_tickers())}


@celery_app.task(name="collector.dev_readonly_pipeline")
def dev_readonly_pipeline() -> dict:
    """MARKET_DATA_SOURCE=prod_readonly 개발 서버의 일일 작업(beat 기본 23:30 — 상용 20:30 파이프라인이 끝난 뒤).

    마스터 동기화(PG) → 시장 그룹(상용 일봉 읽기 → 개발 CH 쓰기, Q1-a) → 신고저가 특징주(상용 일봉 읽기 → 개발 Redis).
    일봉·지수·수급·재무·CANSLIM·스크리너·패턴은 상용 CH 를 그대로 읽으므로 여기서 하지 않는다(KIS 호출 없음).
    단계 실패 격리·관리자 데이터 현황 기록은 daily_market_pipeline 과 같다.
    """
    out: dict = {}
    record: list[dict] = []
    started = datetime.now(timezone.utc)
    steps = (("master", _sync_master), ("market_groups", lambda: compute_market_groups()),
             ("featured_highs", lambda: compute_featured_highs()))
    for name, step in steps:
        t0 = time.monotonic()
        try:
            out[name] = step()
        except Exception as e:  # noqa: BLE001
            log.exception("개발 경량 파이프라인 단계 실패: %s", name)
            out[name] = {"error": repr(e)[:300]}
        result = out[name]
        record.append({"name": name, "ok": not (isinstance(result, dict) and "error" in result),
                       "seconds": round(time.monotonic() - t0, 1), "summary": pipeline_record.summarize(result)})
    try:
        pipeline_record.save(get_sync_redis(), started, datetime.now(timezone.utc), record)
    except Exception as exc:  # noqa: BLE001
        log.warning("파이프라인 기록 저장 실패: %s", exc)
    return out

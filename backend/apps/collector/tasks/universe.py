"""전종목 수집/백필 Celery 태스크.

- collect_all_daily : 전종목 일봉 겹침창 수집(매일 장 마감 후 beat 예정)
- backfill_all_daily: 전종목 장기 백필(청킹)

공통: 마스터 로드 → 레이트리밋(초당 제한) → 종목별 try/except 실패격리 → 진행로그.
단일 종목 프리미티브(fetch/enrich/upsert)를 재사용하며, KISClient 를 공유해 토큰 캐시를 재활용한다.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import enrich_with_ma
from apps.collector.kis.client import KISClient, KISConnectionError
from apps.collector.kis.fetcher import fetch_domestic_daily, fetch_domestic_daily_range
from apps.collector.rate_limit import RateLimiter
from apps.collector.repositories.clickhouse_ohlcv import upsert_daily_prices
from apps.collector.stock_master import load_domestic_tickers

logger = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30
_LOOKAHEAD_DAYS = 2
# KIS 국내 시세 상한 20 TPS. 8/s(=40%)로도 대량 순회 중 연결계열 실패가 관찰되어
# TPS 초과가 원인은 아니다(원인 진단은 로그의 errno 참조). rate 는 여유를 위한 값.
_DEFAULT_RATE = float(os.getenv("KIS_RATE_PER_SEC", "8"))  # 상한 20/s → 보수적 8/s

_PROGRESS_EVERY = 50
# 적응형 쿨다운: 연결계열(KISConnectionError)이 연속 임계치 이상 발생하면 잠시 쉬어
# throttle/자원 회복 창을 통과시킨다. 연속 실패가 지속되면 쿨다운을 지수적으로 키우고
# (에스컬레이트), 한 건이라도 성공하면 카운터·쿨다운을 리셋한다. 4xx·rt_cd(논리오류)는
# 대상이 아니다(영구 실패 종목이 불필요한 쿨다운을 유발하지 않도록).
_COOLDOWN_THRESHOLD = int(os.getenv("KIS_COOLDOWN_THRESHOLD", "5"))  # 연속 연결실패 임계치
_COOLDOWN_BASE_SEC = float(os.getenv("KIS_COOLDOWN_BASE_SEC", "60"))  # 첫 쿨다운(초)
_COOLDOWN_MAX_SEC = float(os.getenv("KIS_COOLDOWN_MAX_SEC", "600"))  # 쿨다운 상한(초)


def _collect_pass(targets, collect_one, client, limiter, label: str):
    """한 번의 순회 패스: 종목별 실패격리 + 연결계열 연속실패 시 적응형 쿨다운.

    targets: list[(ticker, name)]. client/limiter 는 패스 간 공유(토큰·커넥션 재사용).
    반환: (ok, inserted_sum, failed[dict]). 각 실패 dict 는 retryable 플래그를 갖는다
    (연결계열=True → 2차 재시도 대상, 4xx·rt_cd 논리오류=False → 재시도 무의미).
    """
    ok = 0
    inserted_sum = 0
    failed: list[dict] = []
    consecutive_conn_fail = 0
    cooldown = _COOLDOWN_BASE_SEC
    n = len(targets)

    for i, (ticker, name) in enumerate(targets, 1):
        try:
            limiter.acquire()
            inserted_sum += collect_one(ticker, client)
            ok += 1
            consecutive_conn_fail = 0  # 성공 시에만 리셋(에스컬레이트 유지 목적)
            cooldown = _COOLDOWN_BASE_SEC
        except KISConnectionError as e:  # 연결계열(throttle/자원 신호) → 쿨다운 대상
            # repr 원문 전체 로깅: [Errno 99]/Connection reset/Read timed out 등
            # 근본원인 진단 단서를 자르지 않는다.
            failed.append({"ticker": ticker, "name": name, "error": repr(e), "retryable": True})
            consecutive_conn_fail += 1
            logger.warning(
                "[%s] 연결실패 %s(%s) [연속 %d회]: %s",
                label, ticker, name, consecutive_conn_fail, e,
            )
            if consecutive_conn_fail >= _COOLDOWN_THRESHOLD:
                logger.warning(
                    "[%s] 연속 연결실패 %d회 → %.0f초 쿨다운 후 재개",
                    label, consecutive_conn_fail, cooldown,
                )
                time.sleep(cooldown)
                cooldown = min(cooldown * 2, _COOLDOWN_MAX_SEC)  # 에스컬레이트(성공 전까지)
        except Exception as e:  # 4xx·rt_cd·기타 논리오류 → 재시도 무의미(격리만)
            failed.append({"ticker": ticker, "name": name, "error": repr(e), "retryable": False})
            logger.warning("[%s] 수집실패 %s(%s): %s", label, ticker, name, str(e)[:160])
        if i % _PROGRESS_EVERY == 0:
            logger.info("[%s] 진행 %d/%d (성공 %d, 실패 %d)", label, i, n, ok, len(failed))

    return ok, inserted_sum, failed


def _run_universe(collect_one, limit, source, rate_per_sec) -> dict:
    """공통 루프: 마스터 로드 → 레이트리밋 → 실패격리 → (연결계열) 2차 재시도 → 집계."""
    tickers = load_domestic_tickers(source)
    if limit:
        tickers = tickers[: int(limit)]
    rate = rate_per_sec if rate_per_sec is not None else _DEFAULT_RATE
    limiter = RateLimiter(rate)
    client = KISClient()  # 토큰 캐시·커넥션 풀 공유
    total = len(tickers)
    logger.info("전종목 작업 시작: %d종목 (rate=%s/s)", total, rate)

    first_targets = [(s.ticker, s.name) for s in tickers]
    ok, inserted_sum, failed = _collect_pass(first_targets, collect_one, client, limiter, "1차")

    # 2차 패스: 연결계열 실패만 재시도(쿨다운으로 throttle 창 통과 후 재개).
    # failed 는 dict 리스트이므로 f["ticker"]로 대상을 재구성한다.
    retry_targets = [(f["ticker"], f["name"]) for f in failed if f.get("retryable")]
    retried_ok = 0
    if retry_targets:
        logger.info(
            "연결계열 실패 %d종목 → %.0f초 쿨다운 후 2차 재시도",
            len(retry_targets), _COOLDOWN_BASE_SEC,
        )
        time.sleep(_COOLDOWN_BASE_SEC)
        r_ok, r_inserted, r_failed = _collect_pass(retry_targets, collect_one, client, limiter, "2차")
        retried_ok = r_ok
        ok += r_ok
        inserted_sum += r_inserted
        # 최종 실패 = 1차의 비재시도(논리오류) 실패 + 2차 잔여 실패
        failed = [f for f in failed if not f.get("retryable")] + r_failed

    logger.info(
        "전종목 작업 종료: 성공 %d(2차 회복 %d)/%d, 최종 실패 %d",
        ok, retried_ok, total, len(failed),
    )
    return {
        "total": total,
        "ok": ok,
        "retried_ok": retried_ok,
        "failed_count": len(failed),
        "inserted": inserted_sum,
        "failed_sample": failed[:30],
    }


def _collect_daily_one(ticker: str, client: KISClient) -> int:
    today = date.today()
    start = (today - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end = (today + timedelta(days=_LOOKAHEAD_DAYS)).strftime("%Y%m%d")
    ohlcv = fetch_domestic_daily(ticker, start, end, client=client)
    return upsert_daily_prices(ticker, enrich_with_ma(ohlcv))


@celery_app.task(name="collector.collect_all_daily")
def collect_all_daily(
    limit: int | None = None, source: str | None = None, rate_per_sec: float | None = None
) -> dict:
    """전종목 일봉 겹침창(today-30d~+2d) 수집."""
    return _run_universe(_collect_daily_one, limit, source, rate_per_sec)


@celery_app.task(name="collector.backfill_all_daily")
def backfill_all_daily(
    months: int = 14,
    limit: int | None = None,
    source: str | None = None,
    rate_per_sec: float | None = None,
) -> dict:
    """전종목 장기 백필(청킹). MA 는 종목별 전체 시계열에 한 번만 계산."""
    def _backfill_one(ticker: str, client: KISClient) -> int:
        today = date.today()
        start = (today - timedelta(days=int(months) * 31)).strftime("%Y%m%d")
        end = today.strftime("%Y%m%d")
        ohlcv = fetch_domestic_daily_range(ticker, start, end, client=client)
        return upsert_daily_prices(ticker, enrich_with_ma(ohlcv))

    return _run_universe(_backfill_one, limit, source, rate_per_sec)

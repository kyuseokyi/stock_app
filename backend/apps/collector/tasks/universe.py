"""전종목 수집/백필 Celery 태스크.

- collect_all_daily : 전종목 일봉 겹침창 수집(매일 장 마감 후 beat 예정)
- backfill_all_daily: 전종목 장기 백필(청킹)

공통: 마스터 로드 → 스레드 KIS_WORKERS 개 병렬 → 종목별 try/except 실패격리 → 진행로그.
KIS 응답 대기가 대부분이라 스레드로 병렬화한다(GIL 무관). 초당 호출 제한은 모든 스레드의
KISClient 가 공유하는 RateLimiter 가 HTTP 요청(재시도·J 폴백·백필 청크 포함)마다 건다.
단일 종목 프리미티브(fetch/enrich/upsert)를 재사용하며, 스레드마다 KISClient 를 하나씩 둔다
(토큰은 Redis 공유 캐시). ClickHouse 클라이언트는 프로세스당 1개 재사용(동시 사용 안전).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from apps.collector.celery_app import celery_app
from apps.collector.indicators import enrich_with_ma
from apps.collector.kis.client import KISClient, KISConnectionError
from apps.collector.kis.fetcher import fetch_domestic_daily, fetch_domestic_daily_range
from apps.collector.rate_limit import RateLimiter
from apps.collector.tasks.ohlcv import enrich_overlap_window
from apps.collector.repositories.clickhouse_ohlcv import upsert_daily_prices
from apps.collector.stock_master import load_domestic_tickers

logger = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30
_LOOKAHEAD_DAYS = 2
# KIS 실전(prod) 국내 시세 상한 20 TPS → 기본 15/s(25% 여유). HTTP 요청마다 센다(종목당 1~2회 + 재시도).
# 모의투자(vps)는 상한이 훨씬 낮아 기존 기본 8 을 그대로 둔다(동작 불변). KIS_RATE_PER_SEC 로 덮어쓴다.
# 2026-09 대량 순회 연결 실패의 원인은 TPS 가 아니라 CH 클라이언트 FD 누수였다(해결).
_DEFAULT_RATE = float(
    os.getenv("KIS_RATE_PER_SEC") or ("15" if os.getenv("KIS_MODE", "vps").lower() == "prod" else "8")
)
# 병렬 스레드 수 — 응답 대기를 겹쳐 리미터가 병목이 되게 하는 정도면 충분(1 = 기존 순차)
_DEFAULT_WORKERS = int(os.getenv("KIS_WORKERS", "4"))

_PROGRESS_EVERY = 50
# 적응형 쿨다운: 연결계열(KISConnectionError)이 연속 임계치 이상 발생하면 잠시 쉬어
# throttle/자원 회복 창을 통과시킨다. 연속 실패가 지속되면 쿨다운을 지수적으로 키우고
# (에스컬레이트), 한 건이라도 성공하면 카운터·쿨다운을 리셋한다. 4xx·rt_cd(논리오류)는
# 대상이 아니다(영구 실패 종목이 불필요한 쿨다운을 유발하지 않도록).
# 병렬 수집에서는 연속 카운터·쿨다운을 스레드가 공유하고, 쿨다운 중에는 모든 스레드가 멈춘다.
_COOLDOWN_THRESHOLD = int(os.getenv("KIS_COOLDOWN_THRESHOLD", "5"))  # 연속 연결실패 임계치
_COOLDOWN_BASE_SEC = float(os.getenv("KIS_COOLDOWN_BASE_SEC", "60"))  # 첫 쿨다운(초)
_COOLDOWN_MAX_SEC = float(os.getenv("KIS_COOLDOWN_MAX_SEC", "600"))  # 쿨다운 상한(초)


class _Cooldown:
    """스레드 공유 연결실패 카운터 + 쿨다운 게이트.

    임계치를 넘긴 실패를 겪은 스레드가 쿨다운만큼 자고, 그동안 다른 스레드는 gate 에서 기다린다.
    이미 쿨다운 중이면 새 쿨다운을 겹쳐 시작하지 않는다(진행 중이던 요청의 실패가 몰려도 1회).
    """

    def __init__(self, label: str):
        self.label = label
        self._lock = threading.Lock()
        self._open = threading.Event()
        self._open.set()
        self.consecutive = 0
        self.cooldown = _COOLDOWN_BASE_SEC

    def wait(self) -> None:
        self._open.wait()

    def success(self) -> None:
        with self._lock:
            self.consecutive = 0  # 성공 시에만 리셋(에스컬레이트 유지 목적)
            self.cooldown = _COOLDOWN_BASE_SEC

    def connection_failure(self) -> tuple[int, float]:
        """연속 실패 수를 올린다. 임계치 이상이고 진행 중인 쿨다운이 없으면 게이트를 닫고 쿨다운 초를 돌려준다
        (호출한 스레드가 cool_down 으로 잔다). 아니면 0."""
        with self._lock:
            self.consecutive += 1
            n = self.consecutive
            if n < _COOLDOWN_THRESHOLD or not self._open.is_set():
                return n, 0.0
            sleep_for = self.cooldown
            self.cooldown = min(self.cooldown * 2, _COOLDOWN_MAX_SEC)  # 에스컬레이트(성공 전까지)
            self._open.clear()
            return n, sleep_for

    def cool_down(self, n: int, sleep_for: float) -> None:
        logger.warning("[%s] 연속 연결실패 %d회 → %.0f초 쿨다운 후 재개", self.label, n, sleep_for)
        try:
            time.sleep(sleep_for)
        finally:
            self._open.set()


def _collect_pass(targets, collect_one, get_client, label: str, workers: int = 1):
    """한 번의 순회 패스: 종목별 실패격리 + 연결계열 연속실패 시 적응형 쿨다운(스레드 공유).

    targets: list[(ticker, name)]. get_client(): 현재 스레드의 KISClient(패스 간 재사용).
    workers=1 이면 기존과 같은 순차 처리.
    반환: (ok, inserted_sum, failed[dict]). 각 실패 dict 는 retryable 플래그를 갖는다
    (연결계열=True → 2차 재시도 대상, 4xx·rt_cd 논리오류=False → 재시도 무의미).
    """
    lock = threading.Lock()
    state = {"ok": 0, "inserted": 0, "done": 0}
    failed: list[dict] = []
    gate = _Cooldown(label)
    n = len(targets)

    def run_one(item) -> None:
        ticker, name = item
        gate.wait()  # 쿨다운 중이면 모든 스레드가 여기서 멈춘다
        try:
            inserted = collect_one(ticker, get_client())
        except KISConnectionError as e:  # 연결계열(throttle/자원 신호) → 쿨다운 대상
            # repr 원문 전체 로깅: [Errno 99]/Connection reset/Read timed out 등
            # 근본원인 진단 단서를 자르지 않는다.
            with lock:
                failed.append({"ticker": ticker, "name": name, "error": repr(e), "retryable": True})
            nth, sleep_for = gate.connection_failure()
            logger.warning("[%s] 연결실패 %s(%s) [연속 %d회]: %s", label, ticker, name, nth, e)
            if sleep_for:
                gate.cool_down(nth, sleep_for)
        except Exception as e:  # 4xx·rt_cd·기타 논리오류 → 재시도 무의미(격리만)
            with lock:
                failed.append({"ticker": ticker, "name": name, "error": repr(e), "retryable": False})
            logger.warning("[%s] 수집실패 %s(%s): %s", label, ticker, name, str(e)[:160])
        else:
            gate.success()
            with lock:
                state["ok"] += 1
                state["inserted"] += inserted
        with lock:
            state["done"] += 1
            done, ok, nfail = state["done"], state["ok"], len(failed)
        if done % _PROGRESS_EVERY == 0:
            logger.info("[%s] 진행 %d/%d (성공 %d, 실패 %d)", label, done, n, ok, nfail)

    if workers <= 1:
        for item in targets:
            run_one(item)
    else:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"kis-{label}") as pool:
            list(pool.map(run_one, targets))
    return state["ok"], state["inserted"], failed


def _run_universe(collect_one, limit, source, rate_per_sec, workers: int | None = None, tickers=None) -> dict:
    """공통 루프: 마스터 로드(또는 주어진 tickers) → 병렬 수집(공유 레이트리밋) → 실패격리 → 2차 재시도 → 집계."""
    if tickers is None:
        tickers = load_domestic_tickers(source)
    if limit:
        tickers = tickers[: int(limit)]
    rate = rate_per_sec if rate_per_sec is not None else _DEFAULT_RATE
    workers = max(1, workers if workers is not None else _DEFAULT_WORKERS)
    limiter = RateLimiter(rate)  # 모든 스레드 공유 — HTTP 요청마다 acquire
    local = threading.local()
    clients: list = []
    clients_lock = threading.Lock()

    def get_client():
        # 스레드마다 KISClient 1개(requests.Session 은 스레드 간 공유하지 않는다)
        c = getattr(local, "client", None)
        if c is None:
            c = KISClient(limiter=limiter)
            local.client = c
            with clients_lock:
                clients.append(c)
        return c

    total = len(tickers)
    logger.info("전종목 작업 시작: %d종목 (rate=%s/s, workers=%d)", total, rate, workers)
    started = time.monotonic()
    try:
        first_targets = [(s.ticker, s.name) for s in tickers]
        ok, inserted_sum, failed = _collect_pass(first_targets, collect_one, get_client, "1차", workers)

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
            r_ok, r_inserted, r_failed = _collect_pass(retry_targets, collect_one, get_client, "2차", workers)
            retried_ok = r_ok
            ok += r_ok
            inserted_sum += r_inserted
            # 최종 실패 = 1차의 비재시도(논리오류) 실패 + 2차 잔여 실패
            failed = [f for f in failed if not f.get("retryable")] + r_failed
    finally:
        for c in clients:
            close = getattr(c, "close", None)
            if close is not None:
                close()

    elapsed = time.monotonic() - started
    logger.info(
        "전종목 작업 종료: 성공 %d(2차 회복 %d)/%d, 최종 실패 %d, %.0f초",
        ok, retried_ok, total, len(failed), elapsed,
    )
    return {
        "total": total,
        "ok": ok,
        "retried_ok": retried_ok,
        "failed_count": len(failed),
        "inserted": inserted_sum,
        "elapsed_sec": round(elapsed, 1),
        "failed_sample": failed[:30],
    }


def _collect_daily_one(ticker: str, client: KISClient) -> int:
    today = date.today()
    start = (today - timedelta(days=_LOOKBACK_DAYS)).strftime("%Y%m%d")
    end = (today + timedelta(days=_LOOKAHEAD_DAYS)).strftime("%Y%m%d")
    ohlcv = fetch_domestic_daily(ticker, start, end, client=client)
    return upsert_daily_prices(ticker, enrich_overlap_window(ticker, ohlcv))


@celery_app.task(name="collector.collect_all_daily")
def collect_all_daily(
    limit: int | None = None,
    source: str | None = None,
    rate_per_sec: float | None = None,
    workers: int | None = None,
) -> dict:
    """전종목 일봉 겹침창(today-30d~+2d) 수집. workers 미지정이면 KIS_WORKERS(기본 4)."""
    return _run_universe(_collect_daily_one, limit, source, rate_per_sec, workers)


@celery_app.task(name="collector.backfill_all_daily")
def backfill_all_daily(
    months: int = 14,
    limit: int | None = None,
    source: str | None = None,
    rate_per_sec: float | None = None,
    workers: int | None = None,
) -> dict:
    """전종목 장기 백필(청킹). MA 는 종목별 전체 시계열에 한 번만 계산."""
    def _backfill_one(ticker: str, client: KISClient) -> int:
        today = date.today()
        start = (today - timedelta(days=int(months) * 31)).strftime("%Y%m%d")
        end = today.strftime("%Y%m%d")
        ohlcv = fetch_domestic_daily_range(ticker, start, end, client=client)
        return upsert_daily_prices(ticker, enrich_with_ma(ohlcv))

    return _run_universe(_backfill_one, limit, source, rate_per_sec, workers)

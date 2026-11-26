"""급등락·테마 분석 Celery 작업 — 평일 22:10(상용 20:30 일봉 파이프라인 뒤) + 관리자 재집계.

- 상용·개발 공통. 개발(prod_readonly)은 상용 CH 일봉을 읽고 개발 PG 에 쓴다(KIS 호출 없음, CH 쓰기 없음).
- 같은 날짜 중복 실행은 Redis 잠금(lock:daily_surge:<date>, 30분)으로 막는다. 날짜 없음 = CH 최신 거래일.
- 정기 실행(scheduled)은 '오늘이 거래일이고 오늘 일봉이 있을 때'만 — 휴장일에 지난 날짜를 다시 집계(DART 수백 번)하지 않게.
  23:40 재시도(only_if_missing)는 22:10 에 일봉 미확정으로 건너뛴 날만 채운다.
설계: docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from apps.collector.celery_app import celery_app
from apps.collector.daily_surge import repository as repo
from apps.collector.daily_surge.run import Deps, run_day
from shared import market_calendar
from shared.database import SyncSessionLocal
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

TASK_NAME = "collector.analyze_daily_surge"
LOCK_PREFIX = "lock:daily_surge:"
LOCK_TTL = 1800
KST = ZoneInfo("Asia/Seoul")


def lock_key(day: str) -> str:
    return f"{LOCK_PREFIX}{day}"


def _dart_fetcher():
    from apps.ai_analyst.clients.opendart import get_opendart_client

    client = get_opendart_client()
    if client is None:
        return None

    def fetch(ticker: str, bgn: date, end: date) -> list[tuple[str, str, str]]:
        # strict — 실패는 예외로 올려 '공시 없음'과 구분(저장 때 이전 공시 유지)
        return [(d.rcept_dt, d.rcept_no, d.report_nm)
                for d in client.disclosures_between(ticker, bgn, end, strict=True)]

    return fetch


def _with_session(fn):
    def call(*args):
        with SyncSessionLocal() as db:
            return fn(db, *args)
    return call


def build_deps() -> Deps:
    return Deps(
        latest_date=repo.latest_trade_date,
        prev_date=repo.prev_trade_date,
        load_day=repo.load_day,
        load_prev=repo.load_prev_last,
        profiles=_with_session(repo.load_profiles),
        names=_with_session(repo.load_names),
        themes=_with_session(repo.load_themes),
        dart=_dart_fetcher(),
        store=_with_session(repo.replace_day),
    )


def _today_kst() -> date:
    return datetime.now(KST).date()


def _stored_count(day: str) -> int:
    with SyncSessionLocal() as db:
        return repo.stored_count(db, date.fromisoformat(day))


@celery_app.task(name=TASK_NAME)
def analyze_daily_surge(date: str | None = None, scheduled: bool = False,  # noqa: A002 — 관리자 API kwargs 이름
                        only_if_missing: bool = False) -> dict:
    deps = build_deps()
    if scheduled:
        today = _today_kst()
        if not market_calendar.is_trading_day(today):
            return {"skipped": f"휴장일({today.isoformat()})"}
        latest = deps.latest_date()
        if latest != today:
            return {"skipped": f"오늘 일봉 없음(최신 {latest})"}
    day = date or (d.isoformat() if (d := deps.latest_date()) else None)
    if day is None:
        return {"skipped": "일봉 없음"}
    if only_if_missing and _stored_count(day) > 0:
        return {"skipped": f"이미 집계됨({day})"}
    r = get_sync_redis()
    token = uuid.uuid4().hex
    if not r.set(lock_key(day), token, nx=True, ex=LOCK_TTL):
        return {"skipped": f"실행 중({day})"}
    try:
        out = run_day(day, deps)
        log.info("급등락 분석 %s: %s", day, out)
        return out
    finally:
        try:
            if r.get(lock_key(day)) == token:
                r.delete(lock_key(day))
        except Exception:  # noqa: BLE001 — 잠금은 TTL 로도 풀린다
            log.warning("급등락 분석 잠금 해제 실패(%s)", day)

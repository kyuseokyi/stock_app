"""스크리너(조건검색) 계산 태스크 — 일일 파이프라인 맨 끝(시장 그룹 뒤), 60일 백필.

과거 기준일 백필도 재무는 최신 연간 값, 상장주식수·업종은 현재 프로필을 쓴다(근사).
"""
from __future__ import annotations

import logging
from datetime import date

from apps.collector.celery_app import celery_app
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.repositories import clickhouse_screener as cs
from apps.collector.screener.compute import compute_day
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


def _profiles() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.group_profile_map(db)


def _run_day(as_of: date, universe, profiles, fundamentals) -> dict:
    rows = compute_day(as_of, universe, profiles, cs.load_bars(as_of), fundamentals)
    n = cs.upsert_rows(rows)
    return {"date": as_of.isoformat(), "rows": n, "new_high": sum(1 for r in rows if r["is_new_high"]),
            "golden_cross": sum(1 for r in rows if r["gc_days"] is not None)}


def _prepare():
    chm.ensure_market_tables()  # 재무 테이블이 아직 없어도 로드가 실패하지 않게
    cs.ensure_screener_table()
    return _universe(), _profiles(), cs.load_fundamentals()


@celery_app.task(name="collector.compute_screener")
def compute_screener(as_of: str | None = None) -> dict:
    """기준일(기본: 일봉 최신 거래일) 스크리너 지표 계산·저장 — 같은 날을 다시 돌려도 멱등."""
    universe, profiles, fundamentals = _prepare()
    d = date.fromisoformat(as_of) if as_of else cs.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    out = _run_day(d, universe, profiles, fundamentals)
    log.info("스크리너 계산: %s", out)
    return out


@celery_app.task(name="collector.backfill_screener")
def backfill_screener(days: int = 60) -> dict:
    """최근 days 거래일을 채운다(날짜별 실패 격리)."""
    universe, profiles, fundamentals = _prepare()
    latest = cs.latest_trading_date()
    if latest is None:
        return {"skipped": "일봉 없음"}
    ok, failed = [], []
    for d in cs.trading_dates(latest, int(days)):
        try:
            _run_day(d, universe, profiles, fundamentals)
            ok.append(d.isoformat())
        except Exception as e:  # noqa: BLE001
            log.exception("스크리너 백필 실패 date=%s", d)
            failed.append({"date": d.isoformat(), "error": repr(e)[:300]})
    log.info("스크리너 백필: ok=%d failed=%d", len(ok), len(failed))
    return {"ok": ok, "failed": failed}

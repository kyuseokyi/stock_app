"""CANSLIM 계산 태스크 — 일일 파이프라인 끝(일봉→지수→투자자 뒤), 토요일 재무 수집 뒤, 60일 백필.

분기 EPS 형식: FUNDAMENTALS_Q_CUMULATIVE = true(연초부터 누적) | false(단독 분기) | 미설정(C 는 '준비 중').
과거 기준일 백필도 재무는 최신 수집값을 쓴다(화면에 '실적은 최신 기준' 표기).
"""
from __future__ import annotations

import logging
import os
from datetime import date

from apps.collector.canslim.compute import compute_day
from apps.collector.celery_app import celery_app
from apps.collector.repositories import clickhouse_canslim as cc
from apps.collector.repositories import clickhouse_market as chm
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def q_cumulative_setting() -> bool | None:
    raw = (os.getenv("FUNDAMENTALS_Q_CUMULATIVE") or "").strip().lower()
    if raw in ("true", "1", "yes"):
        return True
    if raw in ("false", "0", "no"):
        return False
    return None


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


def _profiles() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.profile_map(db)


def _run_day(as_of: date, universe, profiles, fundamentals, q_cum) -> dict:
    rows, markets = compute_day(as_of, universe, profiles, cc.load_bars(as_of), cc.load_index_bars(as_of),
                                cc.load_investor(as_of), fundamentals, q_cum)
    n_rows = cc.upsert_rows(rows)
    n_markets = cc.upsert_markets(markets)
    return {"date": as_of.isoformat(), "rows": n_rows, "markets": n_markets,
            "pass5": sum(1 for r in rows if r["pass_count"] >= 5)}


def _prepare():
    chm.ensure_market_tables()  # 지수·수급·재무 테이블이 아직 없어도 로드가 실패하지 않게
    cc.ensure_canslim_tables()
    return _universe(), _profiles(), cc.load_fundamentals(), q_cumulative_setting()


@celery_app.task(name="collector.compute_canslim")
def compute_canslim(as_of: str | None = None) -> dict:
    """기준일(기본: 일봉 최신 거래일) CANSLIM 계산·저장 — 같은 날을 다시 돌려도 멱등."""
    universe, profiles, fundamentals, q_cum = _prepare()
    d = date.fromisoformat(as_of) if as_of else cc.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    out = _run_day(d, universe, profiles, fundamentals, q_cum)
    log.info("CANSLIM 계산: %s (분기 EPS 누적=%s)", out, q_cum)
    return out


@celery_app.task(name="collector.backfill_canslim")
def backfill_canslim(days: int = 60) -> dict:
    """최근 days 거래일을 채워 점수 추이를 보여준다(날짜별 실패 격리)."""
    universe, profiles, fundamentals, q_cum = _prepare()
    latest = cc.latest_trading_date()
    if latest is None:
        return {"skipped": "일봉 없음"}
    ok, failed = [], []
    for d in cc.trading_dates(latest, int(days)):
        try:
            _run_day(d, universe, profiles, fundamentals, q_cum)
            ok.append(d.isoformat())
        except Exception as e:  # noqa: BLE001
            log.exception("CANSLIM 백필 실패 date=%s", d)
            failed.append({"date": d.isoformat(), "error": repr(e)[:300]})
    log.info("CANSLIM 백필: ok=%d failed=%d", len(ok), len(failed))
    return {"ok": ok, "failed": failed}

"""오늘 특징주 Celery 태스크 — 52주 신고가·신저가 스냅숏(20:30 일일 파이프라인 맨 끝 단계 featured_highs).

일봉(CH daily_prices FINAL, UN 기준)과 분석 유니버스(보통주)로 계산해 Redis 에 덮어쓴다(shared.featured_store).
계산 대상이 0종목이면 지난 스냅숏을 그대로 두고 error 를 남긴다(일봉 장애로 카드가 비지 않게).
설계 docs/superpowers/specs/2026-11-17-featured-stocks-design.md
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from apps.collector.celery_app import celery_app
from apps.collector.repositories import clickhouse_screener as cs
from apps.collector.screener import featured
from shared import featured_store, market_repo
from shared.database import SyncSessionLocal
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


@celery_app.task(name="collector.compute_featured_highs")
def compute_featured_highs(as_of: str | None = None, top_n: int = featured.TOP_N) -> dict:
    """기준일(기본: 일봉 최신 거래일) 52주 신고가·신저가 → Redis. 같은 날을 다시 돌려도 같은 결과(덮어쓰기)."""
    d = date.fromisoformat(as_of) if as_of else cs.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    universe = _universe()
    bars = cs.load_bars(d, tickers=[u[0] for u in universe])
    snap = featured.compute(d, universe, bars, top_n)
    if snap["eligible"] == 0:
        msg = f"신고저가 계산 대상 0종목(유니버스 {len(universe)}, 기준일 {d.isoformat()}) — 지난 스냅숏 유지"
        log.warning(msg)
        return {"error": msg}
    snap["computed_at"] = datetime.now(timezone.utc).isoformat()
    featured_store.save_highs(get_sync_redis(), snap)
    out = {"date": snap["date"], "highs": snap["highs"]["count"], "lows": snap["lows"]["count"],
           "eligible": snap["eligible"]}
    log.info("신고저가 계산: %s", out)
    return out

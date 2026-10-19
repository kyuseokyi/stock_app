"""시장 그룹(테마·업종) 계산 태스크 — 일일 파이프라인 끝(CANSLIM 뒤), 관리자 테마 보정 직후(stock_api 가 send_task), 60일 백필.

과거 기준일 백필은 현재 테마 소속·상장주식수로 계산한다(근사).
"""
from __future__ import annotations

import logging
from datetime import date

from apps.collector.celery_app import celery_app
from apps.collector.market_groups.compute import compute_day
from apps.collector.repositories import clickhouse_market_groups as cg
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


def _profiles() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.group_profile_map(db)


def _sector_names() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.sector_name_map(db)


def _themes() -> dict:
    with SyncSessionLocal() as db:
        return market_repo.theme_groups(db)


def _load_themes() -> dict | None:
    """테마 조회가 실패해도 업종은 계산한다(None = 실패 — 숨김 덮어쓰기도 하지 않는다)."""
    try:
        return _themes()
    except Exception:  # noqa: BLE001
        log.exception("테마 조회 실패 — 업종만 계산")
        return None


def _run_day(as_of: date, universe, profiles, sector_names, themes: dict | None) -> dict:
    stock_rows, group_rows = compute_day(as_of, universe, profiles, cg.load_bars(as_of), themes or {}, sector_names)
    removed: list[dict] = []
    if themes is not None:
        current = {r["group_id"] for r in group_rows if r["kind"] == "theme"}
        removed = cg.tombstones(as_of, "theme", cg.existing_group_ids(as_of, "theme"), current)
    cg.upsert_stocks(stock_rows)
    cg.upsert_groups(group_rows + removed)
    return {"date": as_of.isoformat(), "stocks": len(stock_rows),
            "themes": sum(1 for r in group_rows if r["kind"] == "theme"),
            "sectors": sum(1 for r in group_rows if r["kind"] == "sector"), "removed_themes": len(removed)}


def _prepare():
    cg.ensure_market_group_tables()
    return _universe(), _profiles(), _sector_names(), _load_themes()


@celery_app.task(name="collector.compute_market_groups")
def compute_market_groups(as_of: str | None = None) -> dict:
    """기준일(기본: 일봉 최신 거래일) 종목·테마·업종 집계 저장 — 다시 돌려도 멱등."""
    universe, profiles, sector_names, themes = _prepare()
    d = date.fromisoformat(as_of) if as_of else cg.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    out = _run_day(d, universe, profiles, sector_names, themes)
    log.info("시장 그룹 계산: %s", out)
    return out


@celery_app.task(name="collector.backfill_market_groups")
def backfill_market_groups(days: int = 60) -> dict:
    """최근 days 거래일을 채워 순위 추이·기간 비교를 보여준다(날짜별 실패 격리)."""
    universe, profiles, sector_names, themes = _prepare()
    latest = cg.latest_trading_date()
    if latest is None:
        return {"skipped": "일봉 없음"}
    ok, failed = [], []
    for d in cg.trading_dates(latest, int(days)):
        try:
            _run_day(d, universe, profiles, sector_names, themes)
            ok.append(d.isoformat())
        except Exception as e:  # noqa: BLE001
            log.exception("시장 그룹 백필 실패 date=%s", d)
            failed.append({"date": d.isoformat(), "error": repr(e)[:300]})
    log.info("시장 그룹 백필: ok=%d failed=%d", len(ok), len(failed))
    return {"ok": ok, "failed": failed}

"""테마 관리자 화면용 시장 지표 — 테마별 최신 기준일 순위·등락·거래대금, 구성 종목 이름·등락.

collector 가 계산해 둔 market_group_daily / market_stock_daily 를 읽기만 한다.
ClickHouse·PG 조회가 실패해도 보정 화면은 동작해야 하므로 지표만 비우고(null) 경고를 남긴다.
"""
from __future__ import annotations

import logging

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _query(sql: str, params: dict | None = None) -> list:
    return get_client().query(sql, parameters=params or {}).result_rows


def _names(tickers: list[str]) -> dict[str, str]:
    tickers = sorted({t for t in tickers if t})
    if not tickers:
        return {}
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def theme_metrics() -> dict:
    """{"as_of": 기준일|None, "themes": {테마 id(문자열): {rank, chg_1d, value, members, leader_ticker, leader_name}}}."""
    try:
        rows = _query(
            f"SELECT date, group_id, rank, chg_1d, value, members, leader_ticker FROM {DB}.market_group_daily FINAL "
            f"WHERE kind = 'theme' AND members > 0 "
            f"AND date = (SELECT max(date) FROM {DB}.market_group_daily WHERE kind = 'theme')")
        names = _names([r[6] for r in rows])
    except Exception as exc:  # noqa: BLE001
        log.warning("테마 지표 조회 실패: %s", exc)
        return {"as_of": None, "themes": {}}
    if not rows:
        return {"as_of": None, "themes": {}}
    return {"as_of": rows[0][0].isoformat(), "themes": {
        gid: {"rank": int(rank), "chg_1d": chg, "value": value, "members": int(members),
              "leader_ticker": leader, "leader_name": names.get(leader)}
        for _, gid, rank, chg, value, members, leader in rows}}


def attach_stock_metrics(stocks: list[dict]) -> list[dict]:
    """구성 종목 행에 name·chg_1d·value 를 더한다(기존 필드 유지). 조회 실패 시 None."""
    tickers = [s["ticker"] for s in stocks]
    if not tickers:
        return stocks
    try:
        names = _names(tickers)
    except Exception as exc:  # noqa: BLE001
        log.warning("종목 이름 조회 실패: %s", exc)
        names = {}
    try:
        rows = _query(f"SELECT ticker, chg_1d, value FROM {DB}.market_stock_daily FINAL "
                      f"WHERE date = (SELECT max(date) FROM {DB}.market_stock_daily) AND ticker IN %(t)s",
                      {"t": tickers})
    except Exception as exc:  # noqa: BLE001
        log.warning("종목 지표 조회 실패: %s", exc)
        rows = []
    by_ticker = {t: (chg, value) for t, chg, value in rows}
    for s in stocks:
        chg, value = by_ticker.get(s["ticker"], (None, None))
        s.update({"name": names.get(s["ticker"]), "chg_1d": chg, "value": value})
    return stocks

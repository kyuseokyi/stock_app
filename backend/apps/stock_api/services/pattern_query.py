"""차트 패턴 조회 — chart_pattern_daily(CH) 최신 기준일 + 종목명·업종명(PG). GraphQL patternScreen·patternBases 가 쓴다.

계산은 collector(tasks/patterns) 가 매일 해 둔다. SQL 에 들어가는 글자는 이 파일의 상수(리포트·정렬·패턴 종류)뿐이고,
사용자 값은 모두 바인딩 파라미터로 넣는다. 모르는 리포트는 forming, 모르는 정렬은 기본 정렬, 모르는 패턴·시장은 무시한다.
"""
from __future__ import annotations

import json
import logging
from datetime import date

from sqlalchemy import select

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector

log = logging.getLogger(__name__)

_EPOCH = date(1970, 1, 1)
MAX_LIMIT = 200
PATTERN_TYPES = ("cup", "cup_with_handle", "double_bottom", "flat_base", "consolidation", "htf")
MARKETS = ("KOSPI", "KOSDAQ")

# 매수·손절 구간 = 피벗 배수. 돌파 뒤 고가/저가가 아래 한계를 넘으면(이미 크게 오르내림) 구간을 숨긴다.
BUY_HIGH_MULT = 1.05
STOP_LOW_MULT, STOP_HIGH_MULT = 0.92, 0.95
HIDE_ABOVE_MULT = 1.45
HIDE_BELOW_MULT = 0.80

REPORTS = {
    "breakout_today": "days_since_breakout = 1",
    "recent_breakouts": "days_since_breakout BETWEEN 1 AND 20",
    "near_pivot": "is_active = 1 AND close > pivot * 0.90 AND close < pivot * 1.05",
    "forming": "is_active = 1",
}
DEFAULT_REPORT = "forming"
SORTS = {
    "pivot_dist": "abs(close / nullIf(pivot, 0) - 1) ASC NULLS LAST, ticker",
    "breakout_vol": "breakout_vol_pct DESC NULLS LAST, ticker",
    "depth": "depth ASC, ticker",
    "length": "length DESC, ticker",
}
DEFAULT_SORT = "pivot_dist"

_SCREEN_COLUMNS = ["ticker", "market", "close", "pattern_type", "label", "base_count", "pivot", "depth", "length",
                   "is_active", "breakout_date", "breakout_price_pct", "breakout_vol_pct", "days_since_breakout"]
_BASE_COLUMNS = ["pattern_type", "label", "base_count", "subcount", "totalcount", "rim_date", "low_date", "low_price",
                 "pivot", "depth", "length", "is_active", "is_current", "breakout_date", "breakout_price_pct",
                 "breakout_vol_pct", "days_since_breakout", "prior_uptrend_pct", "confidence", "points", "close"]


def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _names(tickers: list[str]) -> dict[str, str]:
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def _sector_names(codes: list[str]) -> dict[str, str]:
    codes = [c for c in codes if c]
    if not codes:
        return {}
    with SyncSessionLocal() as db:
        return dict(db.execute(select(Sector.code, Sector.name).where(Sector.code.in_(codes))).all())


_UNKNOWN_TABLE_CODE = 60  # ClickHouse UNKNOWN_TABLE


def _is_missing_table(exc: Exception) -> bool:
    return (getattr(exc, "code", None) == _UNKNOWN_TABLE_CODE or getattr(exc, "name", None) == "UNKNOWN_TABLE"
            or "UNKNOWN_TABLE" in str(exc))


def latest_date() -> date | None:
    try:
        rows = _query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.chart_pattern_daily")
    except Exception as exc:  # noqa: BLE001
        if _is_missing_table(exc):  # 첫 계산 전(테이블 없음)이면 '준비 중'
            return None
        log.exception("chart_pattern_daily 최신 기준일 조회 실패")  # 연결·타임아웃 등은 GraphQL 오류로 넘긴다
        raise
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def _iso(d) -> str | None:
    return d.isoformat() if d is not None else None


def _sector_by_ticker(d: date, tickers: list[str]) -> dict[str, str]:
    """같은 기준일 screener_daily 의 sector_m → 업종명. 보조 정보: 테이블이 아직 없으면(UNKNOWN_TABLE) 경고 후 빈 값,
    그 밖의 오류(연결·타임아웃 등)는 로그 후 그대로 올린다(screener_query 와 같은 규칙)."""
    if not tickers:
        return {}
    try:
        rows = _query(f"SELECT ticker, sector_m FROM {CLICKHOUSE_DB}.screener_daily FINAL "
                      "WHERE date = %(d)s AND ticker IN %(tickers)s", {"d": d, "tickers": tuple(tickers)})
    except Exception as exc:  # noqa: BLE001
        if _is_missing_table(exc):
            log.warning("screener_daily 테이블 없음 — 업종 없이 응답")
            return {}
        log.exception("패턴 업종명 조회 실패")
        raise
    if not rows:
        log.info("screener_daily 에 %s 기준 행 없음 — 업종 없이 응답", d)
    codes = {t: s for t, s in rows if s}
    names = _sector_names(sorted(set(codes.values())))
    return {t: names[s] for t, s in codes.items() if s in names}


def screen(report: str = DEFAULT_REPORT, pattern_type: str | None = None, market: str | None = None,
           sort: str = DEFAULT_SORT, limit: int = 50, offset: int = 0) -> dict:
    d = latest_date()
    if d is None:
        return {"date": None, "total": 0, "items": []}
    where, params = ["date = %(d)s", "is_current = 1", REPORTS.get(report, REPORTS[DEFAULT_REPORT])], {}
    if pattern_type in PATTERN_TYPES:
        where.append("pattern_type = %(pattern_type)s")
        params["pattern_type"] = pattern_type
    if market in MARKETS:
        where.append("market = %(market)s")
        params["market"] = market
    try:
        limit_n, offset_n = max(1, min(int(limit), MAX_LIMIT)), max(0, int(offset))
    except (TypeError, ValueError):
        limit_n, offset_n = 50, 0
    params.update({"d": d, "limit": limit_n, "offset": offset_n})
    cond = " AND ".join(where)
    table = f"{CLICKHOUSE_DB}.chart_pattern_daily FINAL"
    total = int(_query(f"SELECT count() FROM {table} WHERE {cond}", params)[0][0])
    rows = _query(f"SELECT {', '.join(_SCREEN_COLUMNS)} FROM {table} WHERE {cond} "
                  f"ORDER BY {SORTS.get(sort, SORTS[DEFAULT_SORT])} LIMIT %(limit)s OFFSET %(offset)s", params)
    records = [dict(zip(_SCREEN_COLUMNS, r)) for r in rows]
    tickers = [r["ticker"] for r in records]
    names = _names(tickers) if tickers else {}
    sectors = _sector_by_ticker(d, tickers)
    items = [{
        "ticker": r["ticker"], "name": names.get(r["ticker"], r["ticker"]), "market": r["market"],
        "sector_name": sectors.get(r["ticker"]), "close": r["close"], "pattern_type": r["pattern_type"],
        "label": r["label"], "stage": int(r["base_count"]), "pivot": r["pivot"],
        "pivot_dist_pct": (r["close"] / r["pivot"] - 1) * 100 if r["pivot"] else None,
        "depth": r["depth"], "length": int(r["length"]), "is_active": bool(r["is_active"]),
        "breakout_date": _iso(r["breakout_date"]), "breakout_price_pct": r["breakout_price_pct"],
        "breakout_vol_pct": r["breakout_vol_pct"], "days_since_breakout": r["days_since_breakout"],
    } for r in records]
    return {"date": d.isoformat(), "total": total, "items": items}


def _points(raw) -> list[dict]:
    try:
        pts = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (TypeError, ValueError):
        return []
    return [{"role": str(p.get("role", "")), "date": p.get("date"), "price": p.get("price")}
            for p in pts if isinstance(p, dict)]


def _zones(ticker: str, d: date, current: dict) -> dict | None:
    """현재 베이스의 매수·손절 구간. 돌파했고 돌파일~기준일 고가가 피벗×1.45 초과거나 저가가 ×0.80 미만이면 None."""
    pivot = current["pivot"]
    if not pivot or pivot <= 0:
        return None
    if current["breakout_date"] is not None:
        rows = _query(f"SELECT max(high), min(low), count() FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                      "WHERE ticker = %(t)s AND date >= %(bo)s AND date <= %(d)s",
                      {"t": ticker, "bo": current["breakout_date"], "d": d})
        # 집계는 행이 없어도 (0, 0, 0) 한 행을 돌려준다 -> count 가 0 이면 일봉 없음이라 숨김 판정을 하지 않는다
        hi, lo, n = (rows[0] if rows else (None, None, 0))
        if n and ((hi is not None and hi > pivot * HIDE_ABOVE_MULT) or (lo is not None and lo < pivot * HIDE_BELOW_MULT)):
            return None
    return {"buy_low": pivot, "buy_high": pivot * BUY_HIGH_MULT, "stop_low": pivot * STOP_LOW_MULT,
            "stop_high": pivot * STOP_HIGH_MULT}


def bases(ticker: str) -> dict:
    empty = {"date": None, "ticker": ticker, "name": ticker, "close": None, "bases": [], "zones": None}
    d = latest_date()
    if d is None:
        return empty
    rows = _query(f"SELECT {', '.join(_BASE_COLUMNS)} FROM {CLICKHOUSE_DB}.chart_pattern_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s ORDER BY rim_date", {"d": d, "t": ticker})
    records = [dict(zip(_BASE_COLUMNS, r)) for r in rows]
    if not records:
        return {**empty, "date": d.isoformat()}
    out = [{
        "pattern_type": r["pattern_type"], "label": r["label"], "stage": int(r["base_count"]),
        "subcount": int(r["subcount"]), "totalcount": int(r["totalcount"]), "rim_date": _iso(r["rim_date"]),
        "low_date": _iso(r["low_date"]), "low_price": r["low_price"], "pivot": r["pivot"], "depth": r["depth"],
        "length": int(r["length"]), "is_active": bool(r["is_active"]), "is_current": bool(r["is_current"]),
        "breakout_date": _iso(r["breakout_date"]), "breakout_price_pct": r["breakout_price_pct"],
        "breakout_vol_pct": r["breakout_vol_pct"], "days_since_breakout": r["days_since_breakout"],
        "prior_uptrend_pct": r["prior_uptrend_pct"], "confidence": r["confidence"], "points": _points(r["points"]),
    } for r in records]
    current = [r for r in records if r["is_current"]]
    zones = _zones(ticker, d, current[-1]) if current else None
    return {"date": d.isoformat(), "ticker": ticker, "name": _names([ticker]).get(ticker, ticker),
            "close": records[-1]["close"], "bases": out, "zones": zones}

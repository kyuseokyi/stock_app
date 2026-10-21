"""스크리너 조건검색 조회 — screener_daily(CH) 최신 기준일 + 종목명·업종명(PG). GraphQL screenerScreen 이 쓴다.

계산은 collector(tasks/screener) 가 매일 해 둔다. SQL 에 들어가는 글자는 이 파일의 상수(프리셋·정렬·필터 조각)뿐이고,
사용자 값은 모두 바인딩 파라미터로 넣는다. 범위 값이 이상하면(음수·뒤집힌 min/max·숫자 아님) 그 조건만 무시한다.
"""
from __future__ import annotations

import logging
import math
from datetime import date

from sqlalchemy import select

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector

log = logging.getLogger(__name__)

_EPOCH = date(1970, 1, 1)
MAX_LIMIT = 200
EOK = 1e8                    # 억 원 — 시총·거래대금 필터 단위
VOLUME_SURGE_RATIO = 2.0     # 차트 퀴즈 신호(scripts/generate_chart_quiz.VOLUME_SURGE_RATIO)와 같은 기준
OVERSOLD_RSI = 30.0
BB_SIGMAS = (1.0, 1.5, 2.0, 2.5, 3.0)
DEFAULT_BB_SIGMA = 2.0

# 프리셋 = 서버 상수 조건 묶음(필터와 AND). 키는 웹·앱 상수와 같은 문자열
PRESETS = {
    "volume_surge": f"vol_ratio20 >= {VOLUME_SURGE_RATIO}",
    "golden_cross": "gc_days IS NOT NULL",
    "oversold": f"rsi14 <= {OVERSOLD_RSI}",
    "new_high": "is_new_high = 1",
}
SORTS = {
    "value": "value DESC, ticker",
    "chg": "chg_1d DESC NULLS LAST, ticker",
    "vol_ratio": "vol_ratio20 DESC NULLS LAST, ticker",
    "rsi": "rsi14 DESC NULLS LAST, ticker",
    "mcap": "mcap DESC NULLS LAST, ticker",
    "vp_above": "vp_above_pct ASC NULLS LAST, ticker",
}
# (입력 키, 컬럼, 비교, 배수, 음수 허용) — ROE·매출성장률만 음수가 정상 값
_RANGES = (
    ("price_min", "close", ">=", 1, False), ("price_max", "close", "<=", 1, False),
    ("mcap_min", "mcap", ">=", EOK, False), ("mcap_max", "mcap", "<=", EOK, False),
    ("value_min", "value", ">=", EOK, False),
    ("vol_ratio_min", "vol_ratio20", ">=", 1, False),
    ("rsi_min", "rsi14", ">=", 1, False), ("rsi_max", "rsi14", "<=", 1, False),
    ("vp_above_max", "vp_above_pct", "<=", 1, False),
    ("roe_min", "roe", ">=", 1, True),
    ("per_min", "per", ">=", 1, False), ("per_max", "per", "<=", 1, False),
    ("pbr_min", "pbr", ">=", 1, False), ("pbr_max", "pbr", "<=", 1, False),
    ("debt_ratio_max", "debt_ratio", "<=", 1, False),
    ("sales_growth_min", "sales_growth", ">=", 1, True),
)
_PAIRS = (("price_min", "price_max"), ("mcap_min", "mcap_max"), ("rsi_min", "rsi_max"), ("per_min", "per_max"),
          ("pbr_min", "pbr_max"))
_MA_ORDERS = {"PERFECT": 1, "REVERSE": -1}
_BB_POSITION_SQL = {
    "ABOVE": "close > ma20 + %(bb_k)s * std20",
    "BELOW": "close < ma20 - %(bb_k)s * std20",
    "INSIDE": "close BETWEEN ma20 - %(bb_k)s * std20 AND ma20 + %(bb_k)s * std20",
}
_SCREEN_COLUMNS = ["ticker", "market", "sector_m", "close", "chg_1d", "value", "mcap", "vol_ratio20", "rsi14", "ma20",
                   "std20", "ma_order", "is_new_high", "gc_days", "vp_above_pct", "per", "pbr", "roe"]


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
    """clickhouse_connect Error 의 code(60)·name(UNKNOWN_TABLE), 없으면 메시지의 'UNKNOWN_TABLE' 로 판별."""
    return (getattr(exc, "code", None) == _UNKNOWN_TABLE_CODE or getattr(exc, "name", None) == "UNKNOWN_TABLE"
            or "UNKNOWN_TABLE" in str(exc))


def latest_date() -> date | None:
    try:
        rows = _query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.screener_daily")
    except Exception as exc:  # noqa: BLE001
        if _is_missing_table(exc):  # 첫 계산 전(테이블 없음)이면 '준비 중'
            return None
        log.exception("screener_daily 최신 기준일 조회 실패")  # 연결·타임아웃 등은 GraphQL 오류로 넘긴다
        raise
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def _num(v, allow_negative: bool) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or (x < 0 and not allow_negative):
        return None
    return x


def bb_sigma(filters: dict) -> float:
    s = _num(filters.get("bb_sigma"), False)
    return s if s in BB_SIGMAS else DEFAULT_BB_SIGMA


def bb_position(close: float, ma20: float | None, std20: float | None, k: float) -> str | None:
    if ma20 is None or std20 is None:
        return None
    if close > ma20 + k * std20:
        return "ABOVE"
    if close < ma20 - k * std20:
        return "BELOW"
    return "INSIDE"


def bb_width_pct(ma20: float | None, std20: float | None, k: float) -> float | None:
    if ma20 is None or std20 is None or ma20 <= 0:
        return None
    return 2 * k * std20 * 100 / ma20


def build_where(preset: str | None, filters: dict) -> tuple[list[str], dict]:
    """프리셋(서버 상수) + 필터(화이트리스트) → WHERE 조각과 바인딩 값. 맨 앞은 기준일 조건."""
    where, params = ["date = %(d)s"], {}
    if preset in PRESETS:
        where.append(PRESETS[preset])
    if filters.get("market") in ("KOSPI", "KOSDAQ"):
        where.append("market = %(market)s")
        params["market"] = filters["market"]
    if filters.get("liquid_only", True) is not False:
        where.append("liquid = 1")
    values = {key: _num(filters.get(key), neg) for key, _col, _op, _mult, neg in _RANGES}
    for lo, hi in _PAIRS:
        if values[lo] is not None and values[hi] is not None and values[lo] > values[hi]:
            values[lo] = values[hi] = None  # 뒤집힌 범위는 둘 다 무시
    for key, col, op, mult, _neg in _RANGES:
        if values[key] is not None:
            where.append(f"{col} {op} %({key})s")
            params[key] = values[key] * mult
    if filters.get("ma_order") in _MA_ORDERS:
        where.append("ma_order = %(ma_order)s")
        params["ma_order"] = _MA_ORDERS[filters["ma_order"]]
    k = bb_sigma(filters)
    if filters.get("bb_position") in _BB_POSITION_SQL:
        where.append(_BB_POSITION_SQL[filters["bb_position"]])
        params["bb_k"] = k
    width = _num(filters.get("bb_width_max"), False)
    if width is not None:
        where.append("ma20 > 0 AND 2 * %(bb_k)s * std20 * 100 / ma20 <= %(bb_width_max)s")
        params.update({"bb_k": k, "bb_width_max": width})
    return where, params


def screen(preset: str | None = None, filters: dict | None = None, sort: str = "value", limit: int = 50,
           offset: int = 0) -> dict:
    f = filters or {}
    k = bb_sigma(f)
    d = latest_date()
    if d is None:
        return {"date": None, "total": 0, "bb_sigma": k, "items": []}
    where, params = build_where(preset, f)
    params.update({"d": d, "limit": max(1, min(int(limit), MAX_LIMIT)), "offset": max(0, int(offset))})
    cond = " AND ".join(where)
    table = f"{CLICKHOUSE_DB}.screener_daily FINAL"
    total = int(_query(f"SELECT count() FROM {table} WHERE {cond}", params)[0][0])
    rows = _query(f"SELECT {', '.join(_SCREEN_COLUMNS)} FROM {table} WHERE {cond} "
                  f"ORDER BY {SORTS.get(sort, SORTS['value'])} LIMIT %(limit)s OFFSET %(offset)s", params)
    records = [dict(zip(_SCREEN_COLUMNS, r)) for r in rows]
    names = _names([r["ticker"] for r in records])
    sectors = _sector_names(sorted({r["sector_m"] for r in records}))
    items = [{
        "ticker": r["ticker"], "name": names.get(r["ticker"], r["ticker"]), "market": r["market"],
        "sector_name": sectors.get(r["sector_m"]), "close": r["close"], "chg_1d": r["chg_1d"], "value": r["value"],
        "mcap": r["mcap"], "vol_ratio20": r["vol_ratio20"], "rsi14": r["rsi14"], "ma_order": int(r["ma_order"]),
        "is_new_high": bool(r["is_new_high"]), "gc_days": r["gc_days"], "vp_above_pct": r["vp_above_pct"],
        "per": r["per"], "pbr": r["pbr"], "roe": r["roe"],
        "bb_position": bb_position(r["close"], r["ma20"], r["std20"], k),
        "bb_width_pct": bb_width_pct(r["ma20"], r["std20"], k),
    } for r in records]
    return {"date": d.isoformat(), "total": total, "bb_sigma": k, "items": items}

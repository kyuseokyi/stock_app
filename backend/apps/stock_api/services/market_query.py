"""시장 탭 조회 서비스 — 지수·거시 요약, 테마/업종 순위·트리맵·상세(CH market_*_daily), 일정(PG stock_events).

계산은 collector(tasks/market_groups) 가 매일·보정 시 해 두고, 여기서는 최신 기준일을 읽기만 한다.
사용자 값(kind·period·sort·size)은 화이트리스트로 컬럼 이름에 매핑해서만 SQL 에 들어간다.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from apps.collector.intraday_indices import KST, load_intraday, valid_value
from apps.collector.market_indices import _BASE as INDEX_SPECS
from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import StockEvent, Theme
from shared.sync_redis import get_sync_redis

_EPOCH = date(1970, 1, 1)
KINDS = ("theme", "sector")
PERIODS = {"1d": "chg_1d", "5d": "chg_5d", "20d": "chg_20d"}
SIZES = ("mcap", "value")
CATEGORIES = ("공모주", "경제지표")
MAX_LIMIT = 100
TREEMAP_STOCKS = 30
TREEMAP_THEMES = 30
HISTORY_DAYS = 60
STREAK_TOP = 10
CALENDAR_MAX_DAYS = 92
SPARK_POINTS = 20

# 지수·거시 CH 조회 메모리 캐시(프로세스별) — 화면이 30초마다 개요를 다시 부르므로 사용자 수만큼 CH 로 가지 않게.
# Redis 장중 값은 캐시하지 않는다(덧씌우기는 매번).
CACHE_SECONDS = 30
_CACHE: dict[str, tuple[float, object, list]] = {}  # 이름 → (만료 시각 monotonic, 키, 행)

# series_id → (화면 이름, 단위)
MACRO_NAMES = {
    "CPIAUCSL": ("미국 CPI(전년 대비)", "%"),
    "CPILFESL": ("근원 CPI(전년 대비)", "%"),
    "PCEPILFE": ("근원 PCE(전년 대비)", "%"),
    "UNRATE": ("실업률", "%"),
    "PAYEMS": ("비농업 고용", "천 명"),
    "FEDFUNDS": ("기준금리(실효)", "%"),
    "DGS10": ("미 국채 10년", "%"),
    "DGS2": ("미 국채 2년", "%"),
    "T10Y2Y": ("장단기 금리차(10년-2년)", "%p"),
}
YOY_SERIES = frozenset({"CPIAUCSL", "CPILFESL", "PCEPILFE"})  # 물가 '지수'라 수준값 대신 전년 대비 % 로 보여준다

_GROUP_COLUMNS = ["group_id", "name", "members", "chg_1d", "chg_5d", "chg_20d", "value", "mcap", "up", "down",
                  "flat", "leader_ticker", "leader_chg", "rank"]


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _today() -> date:
    return date.today()


def _clock() -> float:
    return time.monotonic()


def _now_kst() -> datetime:
    """장중 덧씌우기 기준 시각 — 컨테이너 TZ 와 무관하게 KST."""
    return datetime.now(KST)


def _intraday() -> dict:
    """Redis 장중 값(collector.poll_intraday_indices). Redis 장애·형식 오류면 빈 값 — 확정 값만 보인다."""
    try:
        return load_intraday(get_sync_redis())
    except Exception:  # noqa: BLE001
        return {}


def _cached_query(name: str, key, sql: str, params: dict) -> list:
    """같은 key 로 CACHE_SECONDS 안에 다시 부르면 저장해 둔 행. 실패(예외)는 저장하지 않고 그대로 올린다."""
    now = _clock()
    hit = _CACHE.get(name)
    if hit is not None and hit[0] > now and hit[1] == key:
        return hit[2]
    rows = _query(sql, params)
    _CACHE[name] = (now + CACHE_SECONDS, key, rows)
    return rows


def _names(tickers: list[str]) -> dict[str, str]:
    tickers = sorted({t for t in tickers if t})
    if not tickers:
        return {}
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def _theme_groups() -> dict[str, tuple[str, list[str]]]:
    with SyncSessionLocal() as db:
        return market_repo.theme_groups(db)


def _theme_info(theme_id: str) -> tuple[str | None, dict[str, str]]:
    """(설명, {종목: 편입 사유})."""
    if not theme_id.isdigit():
        return None, {}
    with SyncSessionLocal() as db:
        t = db.get(Theme, int(theme_id))
        return (t.description if t else None), market_repo.theme_reasons(db, int(theme_id))


def _events(start: date, end: date, category: str | None) -> list[tuple]:
    with SyncSessionLocal() as db:
        q = db.query(StockEvent.event_date, StockEvent.title, StockEvent.category, StockEvent.ticker,
                     StockEvent.payload).filter(StockEvent.event_date >= start, StockEvent.event_date <= end)
        if category:
            q = q.filter(StockEvent.category == category)
        return [tuple(r) for r in q.order_by(StockEvent.event_date, StockEvent.id).all()]


# ---------------------------------------------------------------- 공통
def _pick(value: str | None, allowed, default: str) -> str:
    return value if value in allowed else default


def latest_date() -> date | None:
    try:
        rows = _query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.market_group_daily")
    except Exception:  # noqa: BLE001 — 첫 계산 전(테이블 없음)이면 '준비 중'
        return None
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def _pct(a: float | None, b: float | None) -> float | None:
    return None if a is None or not b else a / b * 100 - 100


# ---------------------------------------------------------------- 시장 요약
def _live_point(cur, today_iso: str) -> tuple[float, str] | None:
    """장중 값 한 항목 → (값, KST 'HH:MM'). 오늘 것이 아니거나 형식이 깨졌으면 None."""
    if not isinstance(cur, dict) or cur.get("date") != today_iso:
        return None
    try:
        value = valid_value(cur["value"])  # 유한한 양수만 — NaN·0·문자열이 GraphQL Float 직렬화를 깨지 않게
        if value is None:
            return None
        return value, datetime.fromtimestamp(float(cur["ts"]), KST).strftime("%H:%M")
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        return None


def overlay_intraday(series: list[dict], intraday: dict, today: date) -> list[dict]:
    """확정 종가 지수 목록에 장중 값을 덧씌운다(순수 함수 — 입력을 바꾸지 않음).

    코드별로 장중 값의 date 가 오늘이고 확정 종가 마지막 날짜가 오늘보다 앞이면(= 오늘 종가 미확정):
    추세선 끝에 한 점(길이는 SPARK_POINTS 유지), close = 장중 값, chg1d = 마지막 확정 종가 대비 %(_pct),
    date = 오늘, live = True, as_of = 'HH:MM'. 아니면 확정 값 그대로 live = False, as_of = None.
    """
    iso = today.isoformat()
    out = []
    for item in series:
        base = {**item, "live": False, "as_of": None}
        point = _live_point(intraday.get(item["code"]), iso) if item["date"] < iso else None
        if point is None:
            out.append(base)
            continue
        value, as_of = point
        out.append({**base, "date": iso, "close": value, "chg1d": _pct(value, item["close"]),
                    "spark": (list(item["spark"]) + [value])[-SPARK_POINTS:], "live": True, "as_of": as_of})
    return out


def _indices() -> list[dict]:
    codes = [s.code for s in INDEX_SPECS]
    today = _today()
    try:
        rows = _cached_query("indices", today,
                             f"SELECT code, date, close FROM {CLICKHOUSE_DB}.market_index_daily FINAL "
                             "WHERE code IN %(codes)s AND date > %(since)s ORDER BY code, date",
                             {"codes": tuple(codes), "since": today - timedelta(days=60)})
    except Exception:  # noqa: BLE001
        return []
    series: dict[str, list[tuple]] = {}
    for code, d, close in rows:
        series.setdefault(code, []).append((d, float(close)))
    out = []
    for spec in INDEX_SPECS:
        pts = series.get(spec.code)
        if not pts:
            continue
        closes = [c for _, c in pts]
        out.append({"code": spec.code, "name": spec.name, "region": spec.code.split(":", 1)[0],
                    "date": pts[-1][0].isoformat(), "close": closes[-1],
                    "chg1d": _pct(closes[-1], closes[-2]) if len(closes) > 1 else None,
                    "spark": closes[-SPARK_POINTS:]})
    return overlay_intraday(out, _intraday(), _now_kst().date())


def _yoy(points: list[tuple], i: int) -> float | None:
    d, v = points[i]
    try:
        target = d.replace(year=d.year - 1)
    except ValueError:  # 2월 29일
        target = d.replace(year=d.year - 1, day=28)
    base = next((pv for pd, pv in points if pd == target), None)
    return _pct(v, base)


def _macro() -> list[dict]:
    today = _today()
    try:
        rows = _cached_query("macro", today,
                             f"SELECT series_id, date, value FROM {CLICKHOUSE_DB}.macro_series FINAL "
                             "WHERE series_id IN %(ids)s AND date > %(since)s AND value IS NOT NULL "
                             "ORDER BY series_id, date",
                             {"ids": tuple(MACRO_NAMES), "since": today - timedelta(days=430)})
    except Exception:  # noqa: BLE001
        return []
    series: dict[str, list[tuple]] = {}
    for sid, d, v in rows:
        series.setdefault(sid, []).append((d, float(v)))
    out = []
    for sid, (name, unit) in MACRO_NAMES.items():
        pts = series.get(sid)
        if not pts:
            continue
        if sid in YOY_SERIES:
            value = _yoy(pts, len(pts) - 1)
            prev = _yoy(pts, len(pts) - 2) if len(pts) > 1 else None
            if value is None:
                continue
        else:
            value, prev = pts[-1][1], (pts[-2][1] if len(pts) > 1 else None)
        out.append({"series_id": sid, "name": name, "unit": unit, "date": pts[-1][0].isoformat(),
                    "value": value, "prev": prev})
    return out


def overview() -> dict:
    return {"indices": _indices(), "macro": _macro()}


# ---------------------------------------------------------------- 순위
def _streaks(kind: str, as_of: date, ids: list[str]) -> dict[str, int]:
    """최근부터 연속으로 rank 1~STREAK_TOP 이었던 거래일 수."""
    if not ids:
        return {}
    rows = _query(f"SELECT date, group_id, rank FROM {CLICKHOUSE_DB}.market_group_daily FINAL "
                  "WHERE kind = %(kind)s AND date <= %(d)s AND date > %(since)s AND group_id IN %(ids)s",
                  {"kind": kind, "d": as_of, "since": as_of - timedelta(days=HISTORY_DAYS * 2), "ids": tuple(ids)})
    dates = sorted({r[0] for r in rows}, reverse=True)
    ranks = {(d, gid): rank for d, gid, rank in rows}
    out = {}
    for gid in ids:
        n = 0
        for d in dates:
            if 1 <= ranks.get((d, gid), 0) <= STREAK_TOP:
                n += 1
            else:
                break
        out[gid] = n
    return out


def groups(kind: str = "theme", period: str = "1d", sort: str = "chg", limit: int = 30, offset: int = 0) -> dict:
    d = latest_date()
    if d is None:
        return {"date": None, "total": 0, "items": []}
    kind = _pick(kind, KINDS, "theme")
    col = PERIODS[_pick(period, PERIODS, "1d")]
    where = "date = %(d)s AND kind = %(kind)s AND members > 0" + (" AND rank > 0" if kind == "theme" else "")
    order = "value DESC" if sort == "value" else f"{col} DESC NULLS LAST, value DESC"
    params = {"d": d, "kind": kind, "limit": max(1, min(int(limit), MAX_LIMIT)), "offset": max(0, int(offset))}
    total = int(_query(f"SELECT count() FROM {CLICKHOUSE_DB}.market_group_daily FINAL WHERE {where}", params)[0][0])
    rows = _query(f"SELECT group_id, name, members, {col}, value, up, down, flat, leader_ticker, leader_chg, rank "
                  f"FROM {CLICKHOUSE_DB}.market_group_daily FINAL WHERE {where} ORDER BY {order}, group_id "
                  "LIMIT %(limit)s OFFSET %(offset)s", params)
    streaks = _streaks(kind, d, [r[0] for r in rows])
    names = _names([r[8] for r in rows])
    items = [{"id": gid, "name": name, "members": int(members), "chg": chg, "value": value, "up": int(up),
              "down": int(down), "flat": int(flat),
              "leader": {"ticker": lt, "name": names.get(lt, lt), "chg": lc} if lt else None,
              "rank": int(rank), "streak": streaks.get(gid, 0)}
             for gid, name, members, chg, value, up, down, flat, lt, lc, rank in rows]
    return {"date": d.isoformat(), "total": total, "items": items}


# ---------------------------------------------------------------- 트리맵
def _tiles(stocks: list[tuple], names: dict[str, str]) -> list[dict]:
    """[(ticker, chg, size)] → size 상위 TREEMAP_STOCKS + 나머지 '기타' 1칸."""
    ranked = sorted(stocks, key=lambda s: -(s[2] or 0))
    top, rest = ranked[:TREEMAP_STOCKS], ranked[TREEMAP_STOCKS:]
    tiles = [{"ticker": t, "name": names.get(t, t), "chg": c, "size": s or 0.0} for t, c, s in top]
    if rest:
        chgs = [c for _, c, _ in rest if c is not None]
        tiles.append({"ticker": "", "name": f"기타 {len(rest)}종목", "chg": sum(chgs) / len(chgs) if chgs else None,
                      "size": sum(s or 0 for _, _, s in rest)})
    return tiles


def treemap(kind: str = "sector", size: str = "mcap", period: str = "1d") -> dict:
    d = latest_date()
    if d is None:
        return {"date": None, "groups": []}
    kind = _pick(kind, KINDS, "sector")
    size_col = _pick(size, SIZES, "mcap")
    col = PERIODS[_pick(period, PERIODS, "1d")]
    limit = f" ORDER BY value DESC LIMIT {TREEMAP_THEMES}" if kind == "theme" else ""
    grows = _query(f"SELECT group_id, name, {col} FROM {CLICKHOUSE_DB}.market_group_daily FINAL "
                   f"WHERE date = %(d)s AND kind = %(kind)s AND members > 0{limit}", {"d": d, "kind": kind})
    if kind == "theme":
        membership = _theme_groups()
        members = {gid: membership.get(gid, ("", []))[1] for gid, _, _ in grows}
        tickers = sorted({t for ts in members.values() for t in ts})
        srows = _query(f"SELECT ticker, {col}, {size_col} FROM {CLICKHOUSE_DB}.market_stock_daily FINAL "
                       "WHERE date = %(d)s AND ticker IN %(t)s", {"d": d, "t": tuple(tickers) or ("",)})
        by_ticker = {t: (t, c, s) for t, c, s in srows}
        per_group = {gid: [by_ticker[t] for t in ts if t in by_ticker] for gid, ts in members.items()}
    else:
        srows = _query(f"SELECT ticker, sector_m, {col}, {size_col} FROM {CLICKHOUSE_DB}.market_stock_daily FINAL "
                       "WHERE date = %(d)s", {"d": d})
        per_group = {}
        for t, sector, c, s in srows:
            per_group.setdefault(sector, []).append((t, c, s))
    shown = {gid: sorted(per_group.get(gid, []), key=lambda s: -(s[2] or 0))[:TREEMAP_STOCKS] for gid, _, _ in grows}
    names = _names([t for ss in shown.values() for t, _, _ in ss])
    out = []
    for gid, name, chg in grows:
        tiles = _tiles(per_group.get(gid, []), names)
        total = sum(t["size"] for t in tiles)
        if total > 0:
            out.append({"id": gid, "name": name, "chg": chg, "size": total, "stocks": tiles})
    out.sort(key=lambda g: -g["size"])
    return {"date": d.isoformat(), "groups": out}


# ---------------------------------------------------------------- 그룹 상세
def group(kind: str, group_id: str) -> dict | None:
    d = latest_date()
    if d is None or kind not in KINDS:
        return None
    rows = _query(f"SELECT {', '.join(_GROUP_COLUMNS)} FROM {CLICKHOUSE_DB}.market_group_daily FINAL "
                  "WHERE date = %(d)s AND kind = %(kind)s AND group_id = %(id)s AND members > 0",
                  {"d": d, "kind": kind, "id": group_id})
    if not rows:
        return None
    g = dict(zip(_GROUP_COLUMNS, rows[0]))
    hist = _query(f"SELECT date, chg_1d, rank FROM {CLICKHOUSE_DB}.market_group_daily FINAL "
                  "WHERE kind = %(kind)s AND group_id = %(id)s AND members > 0 AND date <= %(d)s "
                  "ORDER BY date DESC LIMIT %(n)s", {"kind": kind, "id": group_id, "d": d, "n": HISTORY_DAYS})
    cols = "ticker, close, chg_1d, chg_5d, value, mcap"
    description, reasons = None, {}
    if kind == "theme":
        description, reasons = _theme_info(group_id)
        tickers = _theme_groups().get(group_id, ("", []))[1]
        srows = _query(f"SELECT {cols} FROM {CLICKHOUSE_DB}.market_stock_daily FINAL "
                       "WHERE date = %(d)s AND ticker IN %(t)s", {"d": d, "t": tuple(tickers) or ("",)})
    else:
        srows = _query(f"SELECT {cols} FROM {CLICKHOUSE_DB}.market_stock_daily FINAL "
                       "WHERE date = %(d)s AND sector_m = %(id)s", {"d": d, "id": group_id})
    srows = sorted(srows, key=lambda r: -(r[4] or 0))
    names = _names([r[0] for r in srows])
    stocks = [{"ticker": t, "name": names.get(t, t), "close": close, "chg1d": c1, "chg5d": c5, "value": value,
               "mcap": mcap, "is_leader": t == g["leader_ticker"], "reason": reasons.get(t)}
              for t, close, c1, c5, value, mcap in srows]
    return {
        "kind": kind, "id": group_id, "name": g["name"], "description": description, "date": d.isoformat(),
        "chg1d": g["chg_1d"], "chg5d": g["chg_5d"], "chg20d": g["chg_20d"], "value": g["value"], "mcap": g["mcap"],
        "up": int(g["up"]), "down": int(g["down"]), "flat": int(g["flat"]), "rank": int(g["rank"]),
        "history": [{"date": hd.isoformat(), "chg1d": c, "rank": int(r)} for hd, c, r in reversed(hist)],
        "stocks": stocks,
    }


# ---------------------------------------------------------------- 일정
def _parse(s: str | None, default: date) -> date:
    try:
        return date.fromisoformat(s) if s else default
    except ValueError:
        return default


def _ipo_detail(payload: dict | None) -> str:
    p = payload or {}
    parts = []
    price = str(p.get("fix_subscr_pri") or "").replace(",", "").strip()
    if price.isdigit() and int(price) > 0:
        parts.append(f"공모가 {int(price):,}원")
    if (p.get("lead_mgr") or "").strip():
        parts.append(f"주관 {p['lead_mgr'].strip()}")
    return " · ".join(parts)


def calendar(start: str | None, end: str | None, category: str | None = None) -> list[dict]:
    today = _today()
    s = _parse(start, today)
    e = _parse(end, s + timedelta(days=60))
    e = min(max(e, s), s + timedelta(days=CALENDAR_MAX_DAYS))
    rows = _events(s, e, category if category in CATEGORIES else None)
    names = _names([r[3] for r in rows if r[3]])
    out = []
    for d, title, cat, ticker, payload in rows:
        # 상장 전 공모주는 종목 마스터에 없다 → 수집 때 저장한 KIS 응답(payload)의 종목명(isin_name)으로
        name = (names.get(ticker) or str((payload or {}).get("isin_name") or "").strip() or None) if ticker else None
        # 이름 없이 저장된 예전 제목("123450 공모주 청약")은 앞의 티커를 종목명으로 바꿔 보여 준다
        if name and ticker and title.startswith(f"{ticker} "):
            title = f"{name}{title[len(ticker):]}"
        out.append({"date": d.isoformat(), "title": title, "category": cat, "ticker": ticker, "name": name,
                    "detail": _ipo_detail(payload) if cat == "공모주" else "발표 예정"})
    return out

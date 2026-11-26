"""급등락·테마 분석 조회 — 날짜 목록·종목 목록(거르기·정렬)·테마 묶음·상세(성적표)·메모.

하루 저장 행은 수백 개 이하라 거르기·정렬은 파이썬에서 한다(DB 별 JSON 연산 차이를 피함).
성적표(테마 전 종목의 그날 등락률·거래대금)는 저장하지 않고 CH 일봉에서 바로 계산한다 — 급등락이 아닌 종목도 보여 주려고.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.daily_surge_models import DailySurgeNote, DailySurgeStock, DailySurgeThemeGroup


# ---------------------------------------------------------------- 표시 변환
def stock_out(s: DailySurgeStock) -> dict:
    return {
        "date": s.trade_date.isoformat(), "ticker": s.ticker, "name": s.name, "market": s.market,
        "close": s.close, "prev_close": s.prev_close, "change_price": s.change_price, "change_rate": s.change_rate,
        "volume": s.volume, "volume_ratio": s.volume_ratio, "trading_value": s.trading_value,
        "is_surge": s.is_surge, "is_plunge": s.is_plunge, "is_top_value": s.is_top_value,
        "surge_rank": s.surge_rank, "plunge_rank": s.plunge_rank, "value_rank": s.value_rank,
        "primary_theme_id": s.primary_theme_id, "primary_theme_name": s.primary_theme_name,
        "is_theme_leader": s.is_theme_leader, "dart_items": list(s.dart_items or []),
        "dart_keywords": list(s.dart_keywords or []),
        "themes": list(s.themes or []), "sector_name": s.sector_name,
    }


def group_out(g: DailySurgeThemeGroup, note: str | None) -> dict:
    return {
        "date": g.trade_date.isoformat(), "theme_id": g.theme_id, "theme_name": g.theme_name,
        "direction": g.direction, "stock_count": g.stock_count, "avg_change_rate": g.avg_change_rate,
        "value_sum": g.value_sum, "leader_ticker": g.leader_ticker, "leader_name": g.leader_name,
        "members": list(g.members or []), "theme_source": g.theme_source, "note": note,
        "theme_size": g.theme_size,
    }


async def _notes(db: AsyncSession, d: date) -> dict[tuple[str, str], str]:
    rows = await db.execute(select(DailySurgeNote.scope, DailySurgeNote.target, DailySurgeNote.note)
                            .where(DailySurgeNote.trade_date == d))
    return {(scope, target): note for scope, target, note in rows.all()}


def note_for(s: DailySurgeStock, notes: dict[tuple[str, str], str]) -> dict | None:
    """종목 메모 > 대표 테마 메모."""
    if (text := notes.get(("stock", s.ticker))):
        return {"text": text, "scope": "stock", "theme_name": None}
    if s.primary_theme_id is not None and (text := notes.get(("theme", str(s.primary_theme_id)))):
        return {"text": text, "scope": "theme", "theme_name": s.primary_theme_name}
    return None


# ---------------------------------------------------------------- 날짜·목록
async def dates(db: AsyncSession, limit: int = 60) -> list[dict]:
    days = (await db.scalars(select(DailySurgeStock.trade_date).distinct()
                             .order_by(DailySurgeStock.trade_date.desc()).limit(limit))).all()
    if not days:
        return []
    rows = (await db.execute(select(DailySurgeStock.trade_date, DailySurgeStock.is_surge, DailySurgeStock.is_plunge,
                                    DailySurgeStock.is_top_value).where(DailySurgeStock.trade_date.in_(days)))).all()
    groups = (await db.execute(select(DailySurgeThemeGroup.trade_date)
                               .where(DailySurgeThemeGroup.trade_date.in_(days)))).all()
    out = {d: {"date": d.isoformat(), "surge_count": 0, "plunge_count": 0, "value_count": 0, "group_count": 0}
           for d in days}
    for d, surge, plunge, top in rows:
        out[d]["surge_count"] += int(bool(surge))
        out[d]["plunge_count"] += int(bool(plunge))
        out[d]["value_count"] += int(bool(top))
    for (d,) in groups:
        out[d]["group_count"] += 1
    return [out[d] for d in days]


def _in_mode(s: DailySurgeStock, mode: str) -> bool:
    return {
        "surge": s.is_surge, "plunge": s.is_plunge, "value": s.is_top_value,
        "surge_value": s.is_surge and s.is_top_value, "plunge_value": s.is_plunge and s.is_top_value,
    }[mode]


def _in_band(rate: float, band: str) -> bool:
    a = abs(rate)
    if band == "10_15":
        return 10 <= a < 15
    if band == "15_25":
        return 15 <= a < 25
    if band == "25_30":
        return a >= 25
    return True


def _default_sort(mode: str) -> tuple[str, str]:
    if mode == "surge":
        return "change_rate", "desc"
    if mode == "plunge":
        return "change_rate", "asc"
    return "trading_value", "desc"


async def _theme_source(db: AsyncSession, d: date) -> str | None:
    return await db.scalar(select(DailySurgeThemeGroup.theme_source)
                           .where(DailySurgeThemeGroup.trade_date == d).limit(1))


async def list_stocks(db: AsyncSession, d: date, *, mode: str, band: str = "all", market: str = "ALL",
                      dart_only: bool = False, sort: str | None = None, order: str | None = None) -> dict:
    stocks = (await db.scalars(select(DailySurgeStock).where(DailySurgeStock.trade_date == d))).all()
    picked = [s for s in stocks if _in_mode(s, mode)]
    if mode != "value":
        picked = [s for s in picked if _in_band(s.change_rate, band)]
    if market in ("KOSPI", "KOSDAQ"):
        picked = [s for s in picked if s.market == market]
    if dart_only:
        picked = [s for s in picked if s.dart_items]
    key, default_order = _default_sort(mode)
    if sort is not None:
        key, default_order = sort, "desc"
    desc = (order or default_order) == "desc"

    def _key(s: DailySurgeStock):
        v = getattr(s, key)
        return (v is None, -(v or 0) if desc else (v or 0), s.ticker)

    picked.sort(key=_key)
    notes = await _notes(db, d)
    items = [{**stock_out(s), "note": note_for(s, notes)} for s in picked]
    return {"date": d.isoformat(), "theme_source": await _theme_source(db, d) if stocks else None, "items": items}


async def groups(db: AsyncSession, d: date, direction: str | None = None) -> list[dict]:
    stmt = select(DailySurgeThemeGroup).where(DailySurgeThemeGroup.trade_date == d)
    if direction:
        stmt = stmt.where(DailySurgeThemeGroup.direction == direction)
    rows = (await db.scalars(stmt)).all()
    notes = await _notes(db, d)
    rows = sorted(rows, key=lambda g: (g.direction != "up", -g.stock_count, -g.value_sum, g.theme_id))
    return [group_out(g, notes.get(("theme", str(g.theme_id)))) for g in rows]


# ---------------------------------------------------------------- 성적표
def _load_board(trade_date: date, theme_id: int, extra: tuple[str, ...] = ()
                ) -> tuple[list[str], dict[str, tuple[float, float, float]], dict]:
    """(테마 구성 종목, {ticker: (종가, 전일 종가, 거래량)}, {ticker: 이름}) — 지금 테마 구성 ∪ 저장된 묶음 구성원 × 그날 일봉.

    저장 뒤 테마 출처가 바뀌었거나(kis→kiwoom) 종목이 제외돼도 그날 묶음 구성원은 성적표에 남게 extra 를 합친다.
    전일 종가는 종목별 기준일 전 마지막 일봉(집계와 같은 기준).
    """
    from apps.collector.daily_surge import repository as repo
    from shared import market_repo
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
    from shared.database import SyncSessionLocal

    with SyncSessionLocal() as db:
        name_members = market_repo.theme_groups(db).get(str(theme_id))
        members = list(dict.fromkeys([*(name_members[1] if name_members else []), *extra]))
        names = market_repo.names_for(db, members)
    if not members:
        return members, {}, names
    params = {"t": trade_date, "since": trade_date - timedelta(days=repo.PREV_LOOKBACK_DAYS), "tk": tuple(members)}
    today = {t: (float(c), float(v)) for t, c, v in get_client().query(
        f"SELECT ticker, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE date = %(t)s AND ticker IN %(tk)s",
        parameters=params).result_rows}
    before = {t: float(c) for t, c in get_client().query(
        "SELECT ticker, argMax(close, date) FROM ("
        f"SELECT ticker, date, close FROM {CLICKHOUSE_DB}.daily_prices FINAL "
        "WHERE date < %(t)s AND date >= %(since)s AND ticker IN %(tk)s) GROUP BY ticker",
        parameters=params).result_rows}
    prices = {t: (c, before[t], v) for t, (c, v) in today.items() if before.get(t)}
    return members, prices, names


def board_rows(members: list[str], prices: dict[str, tuple[float, float, float]], names: dict[str, str],
               group: DailySurgeThemeGroup | None) -> list[dict]:
    in_group = set(group.members or []) if group else set()
    leader = group.leader_ticker if group else None
    out = []
    for t in members:
        if t not in prices:
            continue
        close, prev_close, volume = prices[t]
        out.append({
            "ticker": t, "name": names.get(t) or t, "close": close,
            "change_rate": round((close - prev_close) / prev_close * 100.0, 2), "trading_value": close * volume,
            "in_group": t in in_group, "is_leader": t == leader,
        })
    out.sort(key=lambda r: (-r["trading_value"], r["ticker"]))
    return out


async def _board(d: date, theme_id: int, group: DailySurgeThemeGroup | None) -> list[dict]:
    extra = tuple(group.members or []) if group else ()
    members, prices, names = await run_in_threadpool(_load_board, d, theme_id, extra)
    return board_rows(members, prices, names, group)


async def stock_detail(db: AsyncSession, d: date, ticker: str) -> dict | None:
    s = await db.get(DailySurgeStock, (d, ticker))
    if s is None:
        return None
    notes = await _notes(db, d)
    theme_note = notes.get(("theme", str(s.primary_theme_id))) if s.primary_theme_id is not None else None
    board: list[dict] = []
    group = None
    if s.primary_theme_id is not None:
        direction = "up" if s.is_surge else "down"
        group = await db.get(DailySurgeThemeGroup, (d, s.primary_theme_id, direction))
        board = await _board(d, s.primary_theme_id, group)
    return {
        "stock": stock_out(s),
        "notes": {"stock": notes.get(("stock", s.ticker)), "theme": theme_note},
        "group": group_out(group, theme_note) if group else None,
        "board": board,
    }


async def theme_detail(db: AsyncSession, d: date, theme_id: int, direction: str) -> dict | None:
    g = await db.get(DailySurgeThemeGroup, (d, theme_id, direction))
    if g is None:
        return None
    notes = await _notes(db, d)
    note = notes.get(("theme", str(theme_id)))
    return {"group": group_out(g, note), "note": note, "board": await _board(d, theme_id, g)}


# ---------------------------------------------------------------- 메모
async def put_note(db: AsyncSession, d: date, scope: str, target: str, note: str, author_id: int | None) -> dict:
    row = await db.scalar(select(DailySurgeNote).where(DailySurgeNote.trade_date == d, DailySurgeNote.scope == scope,
                                                       DailySurgeNote.target == target))
    if row is None:
        db.add(DailySurgeNote(trade_date=d, scope=scope, target=target, note=note, author_id=author_id))
    else:
        row.note, row.author_id = note, author_id
    await db.commit()
    return {"date": d.isoformat(), "scope": scope, "target": target, "note": note}


async def delete_note(db: AsyncSession, d: date, scope: str, target: str) -> None:
    await db.execute(delete(DailySurgeNote).where(DailySurgeNote.trade_date == d, DailySurgeNote.scope == scope,
                                                  DailySurgeNote.target == target))
    await db.commit()


async def name_for(db: AsyncSession, d: date, kind: str, target: str) -> str | None:
    """뉴스 검색어에 쓸 이름 — 그날 저장된 종목명 또는 테마명(없으면 None → 404)."""
    if kind == "stock":
        s = await db.get(DailySurgeStock, (d, target))
        return s.name if s else None
    if not target.isdigit():
        return None
    return await db.scalar(select(DailySurgeThemeGroup.theme_name).where(
        DailySurgeThemeGroup.trade_date == d, DailySurgeThemeGroup.theme_id == int(target)).limit(1))

"""급등락·테마 분석 입출력 — CH 일봉(읽기), PG 프로필·이름·테마(읽기), PG 결과 표(날짜 단위 교체).

일봉은 get_client()(개발 서버에서는 상용 CH 읽기 전용 터널)로 읽는다. 결과는 PG 에만 쓴다(CH 쓰기 없음).
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.daily_surge_models import DailySurgeStock, DailySurgeThemeGroup
from shared.market_models import StockProfile

_STOCK_FIELDS = (
    "name", "market", "close", "prev_close", "change_price", "change_rate", "volume", "volume_ratio",
    "trading_value", "is_surge", "is_plunge", "is_top_value", "surge_rank", "plunge_rank", "value_rank",
    "primary_theme_id", "primary_theme_name", "is_theme_leader", "dart_items", "dart_keywords",
)


# ---------------------------------------------------------------- CH 일봉
def _ch_rows(sql: str, params: dict | None = None, client=None) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def latest_trade_date(client=None) -> date | None:
    rows = _ch_rows(f"SELECT max(date) FROM {CLICKHOUSE_DB}.daily_prices", client=client)
    d = rows[0][0] if rows else None
    return d if isinstance(d, date) and d.year > 1970 else None


def prev_trade_date(d: date, client=None) -> date | None:
    rows = _ch_rows(f"SELECT max(date) FROM {CLICKHOUSE_DB}.daily_prices WHERE date < %(d)s", {"d": d}, client)
    p = rows[0][0] if rows else None
    return p if isinstance(p, date) and p.year > 1970 else None


PREV_LOOKBACK_DAYS = 30


def load_prev_last(d: date, client=None) -> dict[str, tuple[float, float, date]]:
    """{ticker: (종가, 거래량, 그 일봉 날짜)} — 종목마다 기준일 전 30일 안의 마지막 일봉.

    시장 전체 직전 거래일 하나로 자르면 그날 일봉이 빠진 종목·거래정지 후 재개 종목이 사라진다(KRX 기준가도 마지막 종가).
    """
    rows = _ch_rows(
        "SELECT ticker, argMax(close, date), argMax(volume, date), max(date) FROM ("
        f"SELECT ticker, date, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
        "WHERE date < %(d)s AND date >= %(since)s) GROUP BY ticker",
        {"d": d, "since": d - timedelta(days=PREV_LOOKBACK_DAYS)}, client)
    return {str(t): (float(c), float(v), last) for t, c, v, last in rows}


def load_day(d: date, client=None) -> dict[str, tuple[float, float]]:
    """{ticker: (close, volume)} — 그 날짜 일봉(FINAL)."""
    rows = _ch_rows(f"SELECT ticker, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE date = %(d)s",
                    {"d": d}, client)
    return {str(t): (float(c), float(v)) for t, c, v in rows}


# ---------------------------------------------------------------- PG 참조
def load_profiles(session: Session) -> dict[str, tuple[str, bool]]:
    """{ticker: (시장, 보통주 여부)} — ETF·ETN·SPAC·우선주는 보통주 아님.

    거래정지(is_halted)는 '지금' 상태라 과거 날짜를 다시 집계할 때 그날 거래한 종목까지 뺀다 → 쓰지 않는다
    (그날 정지된 종목은 거래량 0·등락 0 이라 어차피 분류되지 않는다).
    """
    rows = session.execute(select(StockProfile.ticker, StockProfile.market, StockProfile.is_etp,
                                  StockProfile.is_spac, StockProfile.is_preferred)).all()
    return {t: (m or "", not (etp or spac or pref)) for t, m, etp, spac, pref in rows}


def load_names(session: Session, tickers: list[str]) -> dict[str, str]:
    return market_repo.names_for(session, tickers)


def load_themes(session: Session) -> tuple[dict[int, tuple[str, list[str]]], str]:
    """지금 쓰는 출처(키움 우선, 없으면 KIS)의 테마와 관리자 테마 — 숨김·제외 빼고. (묶음, 출처)."""
    source = market_repo.active_theme_source(session)["source"]
    groups = market_repo.theme_groups(session)
    return {int(k): (name, list(tickers)) for k, (name, tickers) in groups.items()}, source


# ---------------------------------------------------------------- PG 결과
def stored_count(session: Session, trade_date: date) -> int:
    return int(session.scalar(select(func.count()).select_from(DailySurgeStock)
                              .where(DailySurgeStock.trade_date == trade_date)) or 0)


def replace_day(session: Session, trade_date: date, stocks: list[dict], groups: list[dict], source: str) -> int:
    """그 날짜의 종목·묶음 행을 지우고 다시 넣는다(한 트랜잭션). 메모 표는 건드리지 않는다.

    dart_items 가 None 인 행(이번에 공시 조회 실패)은 예전에 저장한 공시를 그대로 이어 쓴다(빈 값으로 덮지 않게).
    """
    keep = {s.ticker: (s.dart_items, s.dart_keywords) for s in session.scalars(
        select(DailySurgeStock).where(DailySurgeStock.trade_date == trade_date))}
    session.execute(delete(DailySurgeStock).where(DailySurgeStock.trade_date == trade_date))
    session.execute(delete(DailySurgeThemeGroup).where(DailySurgeThemeGroup.trade_date == trade_date))
    for r in stocks:
        values = {k: r.get(k) for k in _STOCK_FIELDS}
        if values["dart_items"] is None:
            old_items, old_keywords = keep.get(r["ticker"], ([], []))
            values["dart_items"], values["dart_keywords"] = list(old_items or []), list(old_keywords or [])
        session.add(DailySurgeStock(trade_date=trade_date, ticker=r["ticker"], **values))
    for g in groups:
        session.add(DailySurgeThemeGroup(
            trade_date=trade_date, theme_id=g["theme_id"], direction=g["direction"], theme_name=g["theme_name"],
            stock_count=g["stock_count"], avg_change_rate=g["avg_change_rate"], value_sum=g["value_sum"],
            leader_ticker=g["leader_ticker"], leader_name=g["leader_name"], members=list(g["members"]),
            theme_source=source,
        ))
    session.commit()
    return len(stocks)

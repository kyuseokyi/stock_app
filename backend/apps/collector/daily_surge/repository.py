"""급등락·테마 분석 입출력 — CH 일봉(읽기), PG 프로필·이름·테마(읽기), PG 결과 표(날짜 단위 교체).

일봉은 get_client()(개발 서버에서는 상용 CH 읽기 전용 터널)로 읽는다. 결과는 PG 에만 쓴다(CH 쓰기 없음).
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import delete, select
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


def load_day(d: date, client=None) -> dict[str, tuple[float, float]]:
    """{ticker: (close, volume)} — 그 날짜 일봉(FINAL)."""
    rows = _ch_rows(f"SELECT ticker, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE date = %(d)s",
                    {"d": d}, client)
    return {str(t): (float(c), float(v)) for t, c, v in rows}


# ---------------------------------------------------------------- PG 참조
def load_profiles(session: Session) -> dict[str, tuple[str, bool]]:
    """{ticker: (시장, 보통주 여부)} — ETF·ETN·SPAC·우선주·거래정지는 보통주 아님."""
    rows = session.execute(select(StockProfile.ticker, StockProfile.market, StockProfile.is_etp,
                                  StockProfile.is_spac, StockProfile.is_preferred, StockProfile.is_halted)).all()
    return {t: (m or "", not (etp or spac or pref or halted)) for t, m, etp, spac, pref, halted in rows}


def load_names(session: Session, tickers: list[str]) -> dict[str, str]:
    return market_repo.names_for(session, tickers)


def load_themes(session: Session) -> tuple[dict[int, tuple[str, list[str]]], str]:
    """지금 쓰는 출처(키움 우선, 없으면 KIS)의 테마와 관리자 테마 — 숨김·제외 빼고. (묶음, 출처)."""
    source = market_repo.active_theme_source(session)["source"]
    groups = market_repo.theme_groups(session)
    return {int(k): (name, list(tickers)) for k, (name, tickers) in groups.items()}, source


# ---------------------------------------------------------------- PG 결과
def replace_day(session: Session, trade_date: date, stocks: list[dict], groups: list[dict], source: str) -> int:
    """그 날짜의 종목·묶음 행을 지우고 다시 넣는다(한 트랜잭션). 메모 표는 건드리지 않는다."""
    session.execute(delete(DailySurgeStock).where(DailySurgeStock.trade_date == trade_date))
    session.execute(delete(DailySurgeThemeGroup).where(DailySurgeThemeGroup.trade_date == trade_date))
    for r in stocks:
        session.add(DailySurgeStock(trade_date=trade_date, ticker=r["ticker"],
                                    **{k: r.get(k) for k in _STOCK_FIELDS}))
    for g in groups:
        session.add(DailySurgeThemeGroup(
            trade_date=trade_date, theme_id=g["theme_id"], direction=g["direction"], theme_name=g["theme_name"],
            stock_count=g["stock_count"], avg_change_rate=g["avg_change_rate"], value_sum=g["value_sum"],
            leader_ticker=g["leader_ticker"], leader_name=g["leader_name"], members=list(g["members"]),
            theme_source=source,
        ))
    session.commit()
    return len(stocks)

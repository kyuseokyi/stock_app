"""관리자 데이터 검증 — 종목 하나의 우리 값을 한 번에 모아 외부 사이트(네이버·FnGuide·DART)와 눈으로 비교하게 한다.

- 읽기 전용이다. 섹션마다 조회 실패를 격리한다(그 섹션만 null + notes[섹션]).
- CH 테이블이 아직 없으면(Code 60) 빈 값과 안내를 준다(data_status._missing_table 과 같은 판정).
- ReplacingMergeTree 테이블은 FINAL 을 쓰고 ticker 로 거른다.
- 날짜를 주지 않으면 그 종목의 최신 일봉 날짜를 쓴다. 거래정지 종목도 마지막 거래일 값이 보인다.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable
from urllib.parse import quote

from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector, StockProfile
from shared.models import StockMeta

log = logging.getLogger(__name__)

TICKER_RE = re.compile(r"[0-9A-Z]{6}")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")  # py3.12 fromisoformat 은 '20261016' 도 받아서 형식을 먼저 본다
_EPOCH = date(1970, 1, 1)
BAR_ROWS = 5
QUARTERS = 8
YEARS = 5
FAILED = "조회에 실패했어요(서버 로그 확인)"
TABLE_MISSING = "아직 계산·수집된 적이 없어요(테이블 없음)"
NO_BARS = "일봉이 없어 기준일을 정할 수 없어요"

INVESTOR_COLS = ("prsn_qty", "frgn_qty", "orgn_qty", "prsn_amt", "frgn_amt", "orgn_amt")
FUND_COLS = ("stac_yymm", "eps", "bps", "sps", "roe", "sales_growth", "op_growth", "ni_growth", "debt_ratio")
CANSLIM_COLS = ("score", "pass_count", "liquid", "c", "a", "n", "s", "l", "i", "m", "c_growth", "c_quarter",
                "c_turnaround", "a_cagr", "a_roe", "n_pct_from_high", "n_high_52w", "s_ud_ratio", "l_rs", "l_rs_raw",
                "sector_rs_rank", "sector_rs_count", "i_net_qty", "i_buy_days", "m_dist_days", "avg_value_20d")


class InvalidTicker(ValueError):
    """종목 코드 형식 오류(영문 대문자·숫자 6자리)."""


class InvalidDate(ValueError):
    """날짜 형식 오류(YYYY-MM-DD)."""


class StockNotFound(LookupError):
    """stock_meta 에도 없고 일봉도 없음."""


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _stock_info(ticker: str) -> dict | None:
    """stock_meta + stock_profile + sectors. stock_meta 에 없으면 None."""
    with SyncSessionLocal() as db:
        meta = db.get(StockMeta, ticker)
        if meta is None:
            return None
        prof = db.get(StockProfile, ticker)
        code = prof.sector_m if prof is not None and prof.sector_m else None
        sector = db.get(Sector, code) if code else None
        market = meta.market.value if hasattr(meta.market, "value") else str(meta.market)
        return {"name": meta.name, "market": market, "is_active": bool(meta.is_active),
                "sector_code": code, "sector_name": sector.name if sector is not None else None,
                "listed_shares_k": prof.listed_shares_k if prof is not None else None,
                "is_halted": bool(prof.is_halted) if prof is not None else None}


def _theme_memberships(ticker: str) -> list[tuple[str, str]]:
    """[(테마 id 문자열, 이름)] — 숨김 테마·제외 종목 빼고(시장 그룹 계산과 같은 기준)."""
    with SyncSessionLocal() as db:
        groups = market_repo.theme_groups(db)
    return [(gid, name) for gid, (name, tickers) in groups.items() if ticker in tickers]


# ---------------------------------------------------------------- 입력
def normalize_ticker(raw: str | None) -> str:
    t = (raw or "").strip().upper()
    if not TICKER_RE.fullmatch(t):
        raise InvalidTicker(raw)
    return t


def parse_date(raw: str | None) -> date | None:
    if raw is None or not raw.strip():
        return None
    s = raw.strip()
    if not DATE_RE.fullmatch(s):
        raise InvalidDate(raw)
    try:
        return date.fromisoformat(s)
    except ValueError as exc:
        raise InvalidDate(raw) from exc


# ---------------------------------------------------------------- 도우미
def _missing_table(exc: Exception) -> bool:
    msg = str(exc)
    return "UNKNOWN_TABLE" in msg or "Code: 60." in msg


def _section(name: str, fn: Callable[[], object], notes: dict, empty=None):
    """섹션 하나 — 실패하면 null + notes[name]. 테이블이 없으면 empty + 안내."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — 한 섹션 실패가 화면 전체를 막지 않게
        if _missing_table(exc):
            notes[name] = TABLE_MISSING
            return empty
        log.warning("데이터 검증 조회 실패 %s: %s", name, exc)
        notes[name] = FAILED
        return None


def _f(v) -> float | None:
    return None if v is None else float(v)


def links(ticker: str, name: str | None) -> list[dict]:
    out = [
        {"label": "네이버 종목", "url": f"https://finance.naver.com/item/main.naver?code={ticker}"},
        {"label": "네이버 일별시세", "url": f"https://finance.naver.com/item/sise_day.naver?code={ticker}"},
        {"label": "네이버 투자자별 매매", "url": f"https://finance.naver.com/item/frgn.naver?code={ticker}"},
        {"label": "FnGuide", "url": f"https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?gicode=A{ticker}"},
    ]
    if name:
        out.append({"label": "DART 공시",
                    "url": f"https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm={quote(name)}"})
    return out


# ---------------------------------------------------------------- 섹션
def _resolve_date(ticker: str, requested: date | None) -> date | None:
    if requested:
        return requested
    rows = _query(f"SELECT max(date) FROM {DB}.daily_prices WHERE ticker = %(t)s", {"t": ticker})
    d = rows[0][0] if rows else None
    return None if d is None or d <= _EPOCH else d


def _bars(ticker: str, d: date) -> list[dict]:
    rows = _query(f"SELECT date, open, high, low, close, volume FROM {DB}.daily_prices FINAL "
                  "WHERE ticker = %(t)s AND date <= %(d)s ORDER BY date DESC LIMIT %(n)s",
                  {"t": ticker, "d": d, "n": BAR_ROWS})
    return [{"date": r[0].isoformat(), "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
             "close": float(r[4]), "volume": int(r[5])} for r in rows]


def _computed(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT close, chg_1d, chg_5d, chg_20d, value, mcap, sector_m FROM {DB}.market_stock_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s", {"t": ticker, "d": d})
    if not rows:
        return None
    close, c1, c5, c20, value, mcap, sector_m = rows[0]
    return {"close": float(close), "chg_1d": _f(c1), "chg_5d": _f(c5), "chg_20d": _f(c20), "value": float(value),
            "mcap": _f(mcap), "sector_m": sector_m}


def _investor(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT {', '.join(INVESTOR_COLS)} FROM {DB}.investor_daily FINAL "
                  "WHERE ticker = %(t)s AND date = %(d)s", {"t": ticker, "d": d})
    return dict(zip(INVESTOR_COLS, (int(v) for v in rows[0]))) if rows else None


def _fundamentals(ticker: str) -> dict:
    """분기 최근 QUARTERS 개·연간 최근 YEARS 개(최신이 앞). 누적/단독 판단은 관리자가 원값을 보고 한다."""
    rows = _query(f"SELECT period, {', '.join(FUND_COLS)} FROM {DB}.fundamentals_periodic FINAL "
                  "WHERE ticker = %(t)s ORDER BY period, stac_yymm DESC", {"t": ticker})
    quarterly, annual = [], []
    for period, ym, *vals in rows:
        item = {"stac_yymm": ym, **{c: _f(v) for c, v in zip(FUND_COLS[1:], vals)}}
        if period == "Q" and len(quarterly) < QUARTERS:
            quarterly.append(item)
        elif period == "Y" and len(annual) < YEARS:
            annual.append(item)
    return {"quarterly": quarterly, "annual": annual}


def _canslim(ticker: str, d: date) -> dict | None:
    rows = _query(f"SELECT {', '.join(CANSLIM_COLS)} FROM {DB}.canslim_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s", {"t": ticker, "d": d})
    return dict(zip(CANSLIM_COLS, rows[0])) if rows else None


def _memberships(ticker: str, d: date, profile: dict | None, notes: dict) -> list[dict]:
    """업종 1개 + 소속 테마, 그날 market_group_daily 지표(members > 0 만 — 숨김 tombstone 제외)."""
    wanted: list[tuple[str, str, str | None]] = []
    if profile and profile.get("sector_code"):
        wanted.append(("sector", profile["sector_code"], profile.get("sector_name")))
    wanted += [("theme", gid, name) for gid, name in _theme_memberships(ticker)]
    if not wanted:
        return []
    try:
        rows = _query(f"SELECT kind, group_id, name, rank, chg_1d, members FROM {DB}.market_group_daily FINAL "
                      "WHERE date = %(d)s AND members > 0 AND group_id IN %(ids)s",
                      {"d": d, "ids": sorted({gid for _, gid, _ in wanted})})
    except Exception as exc:
        if not _missing_table(exc):
            raise
        notes["memberships"] = TABLE_MISSING
        rows = []
    found = {(k, g): (n, r, c, m) for k, g, n, r, c, m in rows}
    out = []
    for kind, gid, name in wanted:
        hit = found.get((kind, gid))
        out.append({"kind": kind, "group_id": gid, "name": name or (hit[0] if hit else gid),
                    "rank": int(hit[1]) if hit else None, "chg_1d": _f(hit[2]) if hit else None,
                    "members": int(hit[3]) if hit else None})
    return out


# ---------------------------------------------------------------- 진입점
def build(ticker_raw: str | None, date_raw: str | None = None) -> dict:
    ticker = normalize_ticker(ticker_raw)
    requested = parse_date(date_raw)
    notes: dict[str, str] = {}

    profile, profile_ok = None, True
    try:
        profile = _stock_info(ticker)
    except Exception as exc:  # noqa: BLE001
        log.warning("데이터 검증 프로필 조회 실패 %s: %s", ticker, exc)
        notes["profile"] = FAILED
        profile_ok = False

    d = _section("date", lambda: _resolve_date(ticker, requested), notes)
    if d is None and "date" not in notes:
        notes["date"] = NO_BARS

    def dated(name: str, fn: Callable[[str, date], object]):
        return None if d is None else _section(name, lambda: fn(ticker, d), notes)

    bars = dated("bars", _bars)
    if profile_ok and profile is None and not bars and notes.get("date", NO_BARS) == NO_BARS and "bars" not in notes:
        raise StockNotFound(ticker)

    return {
        "ticker": ticker,
        "date": d.isoformat() if d else None,
        "requested_date": requested.isoformat() if requested else None,
        "profile": profile,
        "bars": bars,
        "computed": dated("computed", _computed),
        "investor": dated("investor", _investor),
        "fundamentals": _section("fundamentals", lambda: _fundamentals(ticker), notes,
                                 empty={"quarterly": [], "annual": []}),
        "canslim": dated("canslim", _canslim),
        "memberships": None if d is None else _section(
            "memberships", lambda: _memberships(ticker, d, profile, notes), notes),
        "links": links(ticker, profile["name"] if profile else None),
        "notes": notes,
    }

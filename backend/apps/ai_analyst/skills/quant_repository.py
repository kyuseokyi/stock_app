"""AI Lab 정량 팩트 입출력 — CH 일봉·CANSLIM·재무, PG 프로필·이름, DART 공시. 계산은 quant_facts 가 한다.

- CH ReplacingMergeTree 테이블은 항상 FINAL.
- 종목별 반복 쿼리 없이: 업종 비교는 CH 2회(그날 업종 종가 + 연간 최신 재무), 시장 폭은 CH 1회 + PG 1회.
- DART 는 키가 없거나 실패하면 None(공시 생략).
- as_of(과거 기준일)가 주어지면 미래 자료를 쓰지 않는다(공시 지연을 감안한 보수적 규칙):
  재무는 결산월 말일이 as_of 보다 연간(Y) 90일·분기(Q) 45일 이상 이전인 것만, DART 는 as_of 전날까지.
  as_of 가 없으면(오늘 기준 미리 보기) 최신 재무·오늘까지 공시.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.ai_analyst.clients import opendart
from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.market_models import StockProfile

log = logging.getLogger(__name__)

BARS_LIMIT = 520
LAG_DAYS = {"Y": 90, "Q": 45}  # 결산월 말일 → 공시돼 쓸 수 있다고 보는 최소 경과일
_FUND_COLS = ("period", "stac_yymm", "eps", "bps", "roe", "sales_growth", "op_growth", "ni_growth", "debt_ratio")


def _rows(sql: str, params: dict | None = None, client=None) -> list:
    return (client or get_client()).query(sql, parameters=params or {}).result_rows


def load_daily_bars(ticker: str, as_of: date | None = None, limit: int = BARS_LIMIT, client=None) -> list[dict]:
    """최근 limit 봉(as_of 이하) — 날짜 오름차순."""
    where = "ticker = %(t)s" + (" AND date <= %(d)s" if as_of else "")
    rows = _rows(f"SELECT date, open, high, low, close, volume FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                 f"WHERE {where} ORDER BY date DESC LIMIT %(n)s", {"t": ticker, "d": as_of, "n": int(limit)}, client)
    out: list[dict] = []
    for d, o, h, lo, c, v in reversed(rows):
        close = float(c or 0)
        if close <= 0:  # 종가 없는 봉은 버린다
            continue
        # 거래정지일 등 시가·고가·저가가 0 인 봉 — 0 이 52주 최저·MAE·10봉 최저를 왜곡하지 않게 종가로 대체
        hi = float(h) if h and h > 0 else close
        low = float(lo) if lo and lo > 0 else close
        out.append({"date": d, "open": float(o) if o and o > 0 else close, "high": max(hi, close),
                    "low": min(low, close), "close": close, "volume": float(v or 0)})
    return out


def load_canslim(ticker: str, as_of: date, client=None) -> dict | None:
    """as_of 이하 최신 canslim_daily 한 행 — RS·업종·20일 평균 거래대금."""
    rows = _rows(f"SELECT date, market, sector_m, close, l_rs, avg_value_20d FROM {CLICKHOUSE_DB}.canslim_daily FINAL "
                 "WHERE ticker = %(t)s AND date <= %(d)s ORDER BY date DESC LIMIT 1", {"t": ticker, "d": as_of}, client)
    if not rows:
        return None
    d, market, sector, close, rs, avg_value = rows[0]
    return {"date": d, "market": market, "sector_m": sector, "close": close, "l_rs": rs, "avg_value_20d": avg_value}


def cutoff_yymm(as_of: date, period: str) -> str:
    """as_of 기준 쓸 수 있는 가장 늦은 결산월(YYYYMM) — 결산월 말일 ≤ as_of − LAG_DAYS[period]."""
    c = as_of - timedelta(days=LAG_DAYS[period])
    if (c + timedelta(days=1)).month == c.month:  # c 가 월말이 아니면 그 달 결산은 아직 안 끝남 → 전월
        c = c.replace(day=1) - timedelta(days=1)
    return f"{c.year:04d}{c.month:02d}"


def load_fundamentals(ticker: str, as_of: date | None = None, client=None) -> dict:
    """{"annual": 연간 최신 행 | None, "quarters": 분기 최근 4개(오름차순)}. as_of 가 있으면 공시 지연 규칙으로 거름."""
    rows = _rows(f"SELECT {', '.join(_FUND_COLS)} FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL "
                 "WHERE ticker = %(t)s ORDER BY stac_yymm DESC", {"t": ticker}, client)
    recs = [dict(zip(_FUND_COLS, r)) for r in rows]
    if as_of is not None:
        cut = {p: cutoff_yymm(as_of, p) for p in LAG_DAYS}
        recs = [r for r in recs if r["period"] in cut and str(r["stac_yymm"]) <= cut[r["period"]]]
    annual = next((r for r in recs if r["period"] == "Y"), None)
    quarters = [r for r in recs if r["period"] == "Q"][:4]
    return {"annual": annual, "quarters": list(reversed(quarters))}


def load_sector_peers(sector_m: str, canslim_date: date, price_date: date, as_of: date | None = None,
                      client=None) -> list[dict]:
    """같은 업종 종목 + price_date 일봉 종가(daily_prices FINAL) + 연간 최신 EPS·BPS·ROE.

    업종 구성은 canslim_daily(canslim_date) 의 sector_m, 종가는 대상 종목과 같은 날짜(price_date) 일봉 —
    PER·PBR 을 대상과 같은 날 가격으로 비교한다. 그날 일봉이 없는 종목은 뺀다. 쿼리 3회(종목별 반복 없음).
    as_of 가 있으면 연간 재무는 결산월 ≤ cutoff_yymm(as_of, 'Y').
    """
    if not sector_m:
        return []
    tickers = [r[0] for r in _rows(f"SELECT DISTINCT ticker FROM {CLICKHOUSE_DB}.canslim_daily FINAL "
                                   "WHERE date = %(d)s AND sector_m = %(s)s", {"d": canslim_date, "s": sector_m},
                                   client)]
    if not tickers:
        return []
    closes = dict(_rows(f"SELECT ticker, close FROM {CLICKHOUSE_DB}.daily_prices FINAL "
                        "WHERE date = %(d)s AND ticker IN %(ts)s", {"d": price_date, "ts": tickers}, client))
    if not closes:
        return []
    ym_filter = " AND stac_yymm <= %(ym)s" if as_of is not None else ""
    fund = _rows(f"SELECT ticker, eps, bps, roe FROM {CLICKHOUSE_DB}.fundamentals_periodic FINAL "
                 f"WHERE period = 'Y' AND ticker IN %(ts)s{ym_filter} "
                 "ORDER BY ticker, stac_yymm DESC LIMIT 1 BY ticker",
                 {"ts": list(closes), "ym": cutoff_yymm(as_of, "Y") if as_of is not None else None}, client)
    by = {t: (eps, bps, roe) for t, eps, bps, roe in fund}
    none3 = (None, None, None)
    return [{"ticker": t, "close": c, "eps": by.get(t, none3)[0], "bps": by.get(t, none3)[1],
             "roe": by.get(t, none3)[2]} for t, c in closes.items()]


def load_profile(session: Session, ticker: str) -> dict | None:
    row = session.execute(select(StockProfile.market, StockProfile.sector_m).where(StockProfile.ticker == ticker)).first()
    return {"market": row[0], "sector_m": row[1]} if row else None


def load_breadth_rows(session: Session, market: str, d: date, client=None) -> list[dict]:
    """그날 같은 시장 보통주(ETF·ETN·SPAC·우선주 제외)의 종가·20·50일선."""
    commons = set(session.execute(
        select(StockProfile.ticker).where(StockProfile.market == market, StockProfile.is_etp.is_(False),
                                          StockProfile.is_spac.is_(False), StockProfile.is_preferred.is_(False))
    ).scalars())
    if not commons:
        return []
    rows = _rows(f"SELECT ticker, close, ma20, ma50 FROM {CLICKHOUSE_DB}.daily_prices FINAL WHERE date = %(d)s",
                 {"d": d}, client)
    return [{"close": c, "ma20": m20, "ma50": m50} for t, c, m20, m50 in rows if t in commons]


def load_name(session: Session, ticker: str) -> str | None:
    return market_repo.names_for(session, [ticker]).get(ticker)


def load_dart(ticker: str, as_of: date | None = None, days: int = 90) -> list[dict] | None:
    """최근 days 일 공시(제목·접수일·링크). 키 없음·실패 → None.
    as_of 가 있으면 [as_of − days, as_of − 1일] — 기준일 장 마감 뒤 공시가 섞이지 않게. 없으면 오늘까지."""
    client = opendart.get_opendart_client()
    if client is None:
        return None
    try:
        if as_of:
            items = client.disclosures_between(ticker, as_of - timedelta(days=days), as_of - timedelta(days=1))
        else:
            items = client.disclosures(ticker, days=days)
    except Exception as e:  # noqa: BLE001 — 공시는 보조 자료, 실패해도 미리 보기는 계속
        log.warning("AI Lab DART 조회 실패 %s (%s)", ticker, type(e).__name__)
        return None
    return [{"report_nm": x.report_nm, "rcept_no": x.rcept_no, "rcept_dt": x.rcept_dt, "flr_nm": x.flr_nm,
             "url": x.url} for x in items]

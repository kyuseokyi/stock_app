"""CANSLIM 조회 서비스 — canslim_daily·canslim_market(CH) + 종목명·업종명(PG). GraphQL 리졸버가 쓴다.

계산은 collector(tasks/canslim) 가 매일 해 두고, 여기서는 최신 기준일을 읽기만 한다.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select

from apps.collector.repositories.clickhouse_canslim import ROW_COLUMNS
from shared import market_repo
from shared.clickhouse_schema import CLICKHOUSE_DB, get_client
from shared.database import SyncSessionLocal
from shared.market_models import Sector

LETTERS = ("c", "a", "n", "s", "l", "i", "m")
_EPOCH = date(1970, 1, 1)
MAX_LIMIT = 200
HISTORY_DAYS = 60
SCORE_COLUMNS = ROW_COLUMNS
_SCREEN_COLUMNS = ["ticker", "market", "sector_m", "close", "score", "pass_count", "liquid", *LETTERS,
                   "l_rs", "n_pct_from_high"]
_SORTS = {
    "score": "score DESC, l_rs DESC NULLS LAST, ticker",
    "rs": "l_rs DESC NULLS LAST, score DESC, ticker",
    "passCount": "pass_count DESC, score DESC, ticker",
}

# key → (이름, 초보자용 설명, 통과 기준)
LETTER_META = {
    "c": ("최근 분기 실적", "최근 분기 주당순이익(EPS)이 1년 전 같은 분기보다 크게 늘었는지 봅니다.", "전년 같은 분기 대비 +25% 이상"),
    "a": ("연간 실적", "최근 3년 동안 이익이 매년 늘고, 자기자본으로 돈을 잘 버는지(ROE) 봅니다.", "3년 연평균 +25% 이상 · ROE 17% 이상"),
    "n": ("신고가 근처", "주가가 최근 1년 최고가 가까이에 있는지 봅니다. 주도주는 신고가 근처에서 움직여요.", "52주 최고가의 85% 이상"),
    "s": ("거래량 수급", "최근 50일 동안 오른 날 거래량이 내린 날보다 많은지 봅니다. 사려는 힘이 큰지 보는 거예요.", "상승일/하락일 거래량 1.0배 이상"),
    "l": ("주도주", "최근 1년 수익률이 전체 종목 중 상위 20% 안에 드는지 봅니다(RS 등급 1~99).", "RS 80 이상"),
    "i": ("기관·외국인", "최근 20거래일 동안 기관과 외국인이 꾸준히 사들였는지 봅니다.", "순매수 합계 > 0 · 10일 이상 순매수"),
    "m": ("시장 방향", "종목이 속한 시장 지수가 오르는 흐름인지 봅니다. 시장이 나쁘면 좋은 종목도 쉽게 떨어져요.", "지수 50일선 위 · 50일선 > 200일선 · 분산일 5일 미만"),
}


def _ch():
    return get_client()


def _names(tickers: list[str]) -> dict[str, str]:
    with SyncSessionLocal() as db:
        return market_repo.names_for(db, tickers)


def _sector_names(codes: list[str]) -> dict[str, str]:
    codes = [c for c in codes if c]
    if not codes:
        return {}
    with SyncSessionLocal() as db:
        return dict(db.execute(select(Sector.code, Sector.name).where(Sector.code.in_(codes))).all())


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def latest_date() -> date | None:
    try:
        rows = _query(f"SELECT max(date) FROM {CLICKHOUSE_DB}.canslim_daily")
    except Exception:  # noqa: BLE001 — 첫 계산 전(테이블 없음)이면 '준비 중'
        return None
    d = rows[0][0] if rows else None
    return None if d is None or d == _EPOCH else d


def markets() -> list[dict]:
    try:
        rows = _query(f"SELECT market, date, close, ma50, ma200, dist_days, status FROM {CLICKHOUSE_DB}.canslim_market "
                      f"FINAL WHERE date = (SELECT max(date) FROM {CLICKHOUSE_DB}.canslim_market)")
    except Exception:  # noqa: BLE001
        return []
    order = {"KOSPI": 0, "KOSDAQ": 1}
    out = [{"market": m, "date": d.isoformat(), "status": st, "close": c, "ma50": m50, "ma200": m200,
            "distribution_days": int(dist)} for m, d, c, m50, m200, dist, st in rows]
    return sorted(out, key=lambda x: order.get(x["market"], 9))


def screen(market: str = "ALL", min_pass: int = 0, required: list[str] | None = None, sort: str = "score",
           liquid_only: bool = True, limit: int = 50, offset: int = 0) -> dict:
    d = latest_date()
    if d is None:
        return {"date": None, "total": 0, "items": []}
    where = ["date = %(d)s", "pass_count >= %(min_pass)s"]
    params: dict = {"d": d, "min_pass": max(0, int(min_pass)), "limit": max(1, min(int(limit), MAX_LIMIT)),
                    "offset": max(0, int(offset))}
    if market in ("KOSPI", "KOSDAQ"):
        where.append("market = %(market)s")
        params["market"] = market
    if liquid_only:
        where.append("liquid = 1")
    for key in sorted({(k or "").strip().lower() for k in (required or [])} & set(LETTERS)):
        where.append(f"{key} = 1")  # 허용된 항목 이름만(LETTERS) — 사용자 값은 SQL 에 들어가지 않는다
    cond = " AND ".join(where)
    total = int(_query(f"SELECT count() FROM {CLICKHOUSE_DB}.canslim_daily FINAL WHERE {cond}", params)[0][0])
    rows = _query(f"SELECT {', '.join(_SCREEN_COLUMNS)} FROM {CLICKHOUSE_DB}.canslim_daily FINAL WHERE {cond} "
                  f"ORDER BY {_SORTS.get(sort, _SORTS['score'])} LIMIT %(limit)s OFFSET %(offset)s", params)
    records = [dict(zip(_SCREEN_COLUMNS, r)) for r in rows]
    names = _names([r["ticker"] for r in records])
    sectors = _sector_names(sorted({r["sector_m"] for r in records}))
    items = [{
        "ticker": r["ticker"], "name": names.get(r["ticker"], r["ticker"]), "market": r["market"],
        "sector_name": sectors.get(r["sector_m"]), "close": r["close"], "score": r["score"],
        "pass_count": r["pass_count"], "liquid": bool(r["liquid"]),
        "letters": {k: r[k] for k in LETTERS}, "rs": r["l_rs"], "pct_from_high": r["n_pct_from_high"],
    } for r in records]
    return {"date": d.isoformat(), "total": total, "items": items}


def _quarter_label(yymm: str) -> str:
    return f"{yymm[:4]}년 {int(yymm[4:6])}월 분기" if len(yymm or "") == 6 else ""


def letter_display(key: str, row: dict, market_status: str | None) -> str:
    """근거 수치를 사람이 읽는 한 줄로."""
    status = row[key]
    if status == -2:
        return "실적 형식 확인 중"
    if status == -1:
        return "데이터 부족"
    if key == "c":
        q = _quarter_label(row.get("c_quarter") or "")
        if row.get("c_turnaround"):
            return f"흑자 전환 ({q})"
        return f"{row['c_growth']:+.1f}% ({q})" if row.get("c_growth") is not None else f"적자 지속 ({q})"
    if key == "a":
        roe = f"ROE {row['a_roe']:.1f}%" if row.get("a_roe") is not None else "ROE 없음"
        cagr = f"연평균 {row['a_cagr']:+.1f}%" if row.get("a_cagr") is not None else "기준 연도 적자"
        return f"{cagr} · {roe}"
    if key == "n":
        return f"고점 대비 {row['n_pct_from_high']:+.1f}%"
    if key == "s":
        return f"{row['s_ud_ratio']:.2f}배"
    if key == "l":
        sector = (f" · 업종 {row['sector_rs_rank']}/{row['sector_rs_count']}위"
                  if row.get("sector_rs_rank") and row.get("sector_rs_count") else "")
        return f"RS {row['l_rs']}{sector}"
    if key == "i":
        return f"{row['i_net_qty']:+,.0f}주 · {row.get('i_buy_days') or 0}/20일 순매수"
    if key == "m":
        dist = int(row["m_dist_days"]) if row.get("m_dist_days") is not None else 0
        return f"{market_status or '시장'} · 분산일 {dist}일"
    return ""


def _letter_value(key: str, row: dict):
    col = {"c": "c_growth", "a": "a_cagr", "n": "n_pct_from_high", "s": "s_ud_ratio", "l": "l_rs",
           "i": "i_net_qty", "m": "m_dist_days"}[key]
    v = row.get(col)
    return None if v is None else float(v)


def score(ticker: str) -> dict | None:
    d = latest_date()
    if d is None:
        return None
    rows = _query(f"SELECT {', '.join(SCORE_COLUMNS)} FROM {CLICKHOUSE_DB}.canslim_daily FINAL "
                  "WHERE date = %(d)s AND ticker = %(t)s", {"d": d, "t": ticker})
    if not rows:
        return None
    row = dict(zip(SCORE_COLUMNS, rows[0]))
    hist = _query(f"SELECT date, score, pass_count FROM {CLICKHOUSE_DB}.canslim_daily FINAL WHERE ticker = %(t)s "
                  "ORDER BY date DESC LIMIT %(n)s", {"t": ticker, "n": HISTORY_DAYS})
    status = next((m["status"] for m in markets() if m["market"] == row["market"]), None)
    letters = []
    for key in LETTERS:
        label, explanation, threshold = LETTER_META[key]
        letters.append({"key": key, "status": row[key], "value": _letter_value(key, row),
                        "display": letter_display(key, row, status), "threshold": threshold, "label": label,
                        "explanation": explanation})
    return {
        "date": d.isoformat(), "ticker": ticker, "name": _names([ticker]).get(ticker, ticker),
        "market": row["market"], "sector_name": _sector_names([row["sector_m"]]).get(row["sector_m"]),
        "close": row["close"], "score": row["score"], "pass_count": row["pass_count"], "letters": letters,
        "history": [{"date": hd.isoformat(), "score": s, "pass_count": p} for hd, s, p in reversed(hist)],
        "market_status": status,
    }

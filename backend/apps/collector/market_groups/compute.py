"""시장 그룹 하루치 집계 — 일봉·프로필·테마 소속을 받아 market_stock_daily·market_group_daily 행을 만든다(순수).

CH 조회·저장은 repositories/clickhouse_market_groups, 태스크는 tasks/market_groups 가 맡는다.
평균은 단순 평균 — 테마 전체가 움직였는지를 본다(대형주 영향은 트리맵 면적에서 따로 보인다).
"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import date

from shared.sector_group import NO_SECTOR

log = logging.getLogger(__name__)

MIN_MEMBERS = 3      # 이보다 적은 그룹은 순위에서 뺀다
TOP_N_STREAK = 10    # 'n일째 상위' 기준 순위
PERIODS = (1, 5, 20)
# 코스피·코스닥 업종 코드는 따로(00xx / 10xx)인데 이름이 같아("섬유·의류") 화면에서 구분되게 이름 뒤에 시장을 붙인다
MARKET_LABELS = {"KOSPI": "코스피", "KOSDAQ": "코스닥"}


def _chg(closes: list[float], n: int) -> float | None:
    if len(closes) <= n or not closes[-1 - n]:
        return None
    return closes[-1] / closes[-1 - n] * 100 - 100


def stock_values(bars: list[tuple], listed_shares_k: int | None) -> dict:
    """bars: [(date, close, volume)] 오름차순 → 마지막 봉 기준 등락(%)·거래대금(근사)·시총."""
    closes = [b[1] for b in bars]
    close, volume = closes[-1], bars[-1][2]
    out = {"close": close, "value": close * volume,
           "mcap": close * listed_shares_k * 1000 if listed_shares_k else None}
    for n in PERIODS:
        out[f"chg_{n}d"] = _chg(closes, n)
    return out


def _mean(values: list[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def aggregate(kind: str, as_of: date, groups: dict, stocks: dict, halted: set) -> list[dict]:
    """groups: {group_id: (name, [tickers])} → 그룹 행. 거래정지는 집계에서 뺀다. 구성 0 그룹은 행 없음."""
    rows = []
    for gid, (name, tickers) in groups.items():
        members = [stocks[t] | {"ticker": t} for t in dict.fromkeys(tickers) if t in stocks and t not in halted]
        if not members:
            continue
        ups = [m for m in members if (m["chg_1d"] or 0) > 0]
        leader = max(ups or members, key=lambda m: m["value"])
        rows.append({
            "date": as_of, "kind": kind, "group_id": gid, "name": name, "members": len(members),
            **{f"chg_{n}d": _mean([m[f"chg_{n}d"] for m in members]) for n in PERIODS},
            "value": sum(m["value"] for m in members), "mcap": sum(m["mcap"] or 0 for m in members),
            "up": len(ups), "down": sum(1 for m in members if (m["chg_1d"] or 0) < 0),
            "flat": sum(1 for m in members if m["chg_1d"] is not None and m["chg_1d"] == 0),
            "leader_ticker": leader["ticker"], "leader_chg": leader["chg_1d"], "rank": 0,
        })
    ranked = sorted((r for r in rows if r["members"] >= MIN_MEMBERS),
                    key=lambda r: (r["chg_1d"] is None, -(r["chg_1d"] or 0), r["group_id"]))
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i
    return rows


def _sector_name(code: str, sector_names: dict, markets: Counter) -> str:
    """업종 이름 + (시장) — 시장은 코드 앞자리로 추측하지 않고 구성 종목의 시장(가장 많은 것)으로 정한다."""
    base = sector_names.get(code) or code
    if not markets:
        return base
    market = markets.most_common(1)[0][0]
    return f"{base}({MARKET_LABELS.get(market, market)})"


def compute_day(as_of: date, universe: list[tuple], profiles: dict, bars: dict, themes: dict,
                sector_names: dict) -> tuple[list[dict], list[dict]]:
    """profiles: {ticker: (market, 업종 그룹 코드, listed_shares_k, is_halted)} → (종목 행, 그룹 행).

    종목 행 sector_m 열에는 업종 그룹 코드를 저장한다(업종 상세·트리맵이 이 열로 구성 종목을 찾는다).
    """
    stocks: dict[str, dict] = {}
    stock_rows: list[dict] = []
    halted: set[str] = set()
    sectors: dict[str, list[str]] = {}
    sector_markets: dict[str, Counter] = {}
    for ticker, _name, market in universe:
        b = bars.get(ticker)
        if not b or b[-1][0] != as_of:
            continue
        p_market, sector_m, shares, is_halted = profiles.get(ticker, (market, "", None, False))
        sector_m = "" if (sector_m or "").strip() in ("", NO_SECTOR) else sector_m.strip()  # 방어: "0000" 은 업종 없음
        try:
            v = stock_values(b, shares)
        except Exception:  # noqa: BLE001 — 한 종목 오류가 하루 전체를 막지 않게
            log.exception("시장 그룹 종목 계산 실패 ticker=%s", ticker)
            continue
        stocks[ticker] = v
        stock_market = p_market or market
        stock_rows.append({"date": as_of, "ticker": ticker, "market": stock_market, "sector_m": sector_m, **v})
        if is_halted:
            halted.add(ticker)
        if sector_m:
            sectors.setdefault(sector_m, []).append(ticker)
            sector_markets.setdefault(sector_m, Counter())[stock_market] += 1
    sector_groups = {code: (_sector_name(code, sector_names, sector_markets[code]), ts)
                     for code, ts in sectors.items()}
    groups = aggregate("theme", as_of, themes, stocks, halted) + aggregate("sector", as_of, sector_groups,
                                                                            stocks, halted)
    return stock_rows, groups

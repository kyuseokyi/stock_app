"""CANSLIM 하루치 조립 — 입력(일봉·지수·수급·재무·프로필)을 받아 canslim_daily·canslim_market 행을 만든다(순수).

CH 조회·저장은 repositories/clickhouse_canslim, 태스크는 tasks/canslim 이 맡는다.
"""
from __future__ import annotations

import logging
from datetime import date
from statistics import median

from apps.collector.canslim import rules

log = logging.getLogger(__name__)

LETTERS = ("c", "a", "n", "s", "l", "i", "m")


def _market_rows(as_of: date, index_bars: dict) -> tuple[list[dict], dict]:
    markets, states = [], {}
    for market, bars in index_bars.items():
        state = rules.market_state([c for c, _ in bars], [v for _, v in bars])
        states[market] = state
        if state is not None:
            markets.append({"date": as_of, "market": market, "close": state.close, "ma50": state.ma50,
                            "ma200": state.ma200, "dist_days": state.dist_days, "status": state.status})
    return markets, states


def _sector_ranks(raws: dict, profiles: dict) -> tuple[dict, int]:
    """업종(sector_m)별 RS 원값 중앙값 → 순위(1=최강). 반환: {sector_m: rank}, 업종 수."""
    groups: dict[str, list[float]] = {}
    for ticker, raw in raws.items():
        sector = (profiles.get(ticker) or ("", None))[0]
        if raw is not None and sector:
            groups.setdefault(sector, []).append(raw)
    ordered = sorted(groups, key=lambda s: median(groups[s]), reverse=True)
    return {s: i + 1 for i, s in enumerate(ordered)}, len(ordered)


def compute_day(as_of: date, universe, profiles, bars, index_bars, investor, fundamentals,
                q_cumulative: bool | None) -> tuple[list[dict], list[dict]]:
    """universe: [(ticker, name, market)], profiles: {ticker: (sector_m, settle_month)},
    bars: {ticker: [(date, high, close, volume)]}(오래된→최신, as_of 이하), index_bars: {market: [(close, volume)]},
    investor: {ticker: [기관+외국인 순매수]}, fundamentals: {ticker: {"Y": [(yymm, eps, roe)], "Q": [(yymm, eps)]}}.
    기준일 봉이 없는 종목(거래정지 등)은 건너뛴다."""
    markets, states = _market_rows(as_of, index_bars)

    series = {}
    for ticker, _name, market in universe:
        b = bars.get(ticker) or []
        if not b or b[-1][0] != as_of:
            continue
        series[ticker] = (market, [x[1] for x in b], [x[2] for x in b], [x[3] for x in b])

    raws = {t: rules.rs_raw(closes) for t, (_, _, closes, _) in series.items()}
    rs = rules.rs_percentiles(raws)
    sector_rank, sector_count = _sector_ranks(raws, profiles)

    rows = []
    for ticker, (market, highs, closes, volumes) in series.items():
        try:
            sector_m, settle_month = profiles.get(ticker) or ("", None)
            fin = fundamentals.get(ticker) or {}
            v = {
                "c": rules.eval_c(fin.get("Q", []), settle_month, q_cumulative),
                "a": rules.eval_a(fin.get("Y", [])),
                "n": rules.eval_n(highs, closes),
                "s": rules.eval_s(closes, volumes),
                "l": rules.eval_l(rs.get(ticker)),
                "i": rules.eval_i(investor.get(ticker, [])),
                "m": rules.eval_m(states.get(market)),
            }
            total, passed = rules.score(v)
            liquid, avg_value = rules.is_liquid(closes, volumes)
            has_rs = raws.get(ticker) is not None
            rows.append({
                "date": as_of, "ticker": ticker, "market": market, "sector_m": sector_m, "close": closes[-1],
                "score": total, "pass_count": passed, "liquid": int(liquid),
                **{k: v[k].status for k in LETTERS},
                "c_growth": v["c"].value, "c_quarter": v["c"].extra.get("quarter", ""),
                "c_turnaround": int(bool(v["c"].extra.get("turnaround"))),
                "a_cagr": v["a"].value, "a_roe": v["a"].extra.get("roe"),
                "n_pct_from_high": v["n"].value, "n_high_52w": v["n"].extra.get("high_52w"),
                "s_ud_ratio": v["s"].value,
                "l_rs": rs.get(ticker), "l_rs_raw": raws.get(ticker),
                "sector_rs_rank": sector_rank.get(sector_m) if has_rs else None,
                "sector_rs_count": sector_count if has_rs else None,
                "i_net_qty": v["i"].value, "i_buy_days": v["i"].extra.get("buy_days"),
                "m_dist_days": v["m"].value,
                "avg_value_20d": avg_value,
            })
        except Exception:  # noqa: BLE001 — 한 종목 데이터 이상이 하루 계산 전체를 막지 않게
            log.exception("CANSLIM 계산 실패 ticker=%s date=%s", ticker, as_of)
    return rows, markets

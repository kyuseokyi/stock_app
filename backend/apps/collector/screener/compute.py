"""스크리너 하루치 조립 — 일봉·프로필·연간 재무를 받아 screener_daily 행을 만든다(순수).

CH 조회·저장은 repositories/clickhouse_screener, 태스크는 tasks/screener 가 맡는다.
데이터가 모자란 지표는 None — 조회에서 그 지표 조건이 걸리면 결과에서 빠진다.
"""
from __future__ import annotations

import logging
from datetime import date

from apps.collector.canslim.rules import is_liquid
from apps.collector.repositories.clickhouse_screener import ROW_COLUMNS
from apps.collector.screener import indicators as ind
from shared.sector_group import NO_SECTOR

log = logging.getLogger(__name__)

ROW_KEYS = tuple(ROW_COLUMNS)
_FIN_KEYS = ("roe", "eps", "sales_growth", "op_growth", "debt_ratio")


def stock_row(as_of: date, ticker: str, market: str, sector_m: str, bars: list[tuple],
              listed_shares_k: int | None, fin: dict | None) -> dict:
    """bars: [(date, high, low, close, volume)] 오름차순(마지막 = as_of). fin: 최신 연간 재무(없으면 None)."""
    highs = [b[1] for b in bars]
    lows = [b[2] for b in bars]
    closes = [b[3] for b in bars]
    volumes = [b[4] for b in bars]
    close, volume = closes[-1], volumes[-1]
    fin = fin or {}
    prev = ind.prev_high(highs)
    liquid, _avg = is_liquid(closes, volumes)
    return {
        "date": as_of, "ticker": ticker, "market": market, "sector_m": sector_m,
        "close": close, "chg_1d": ind.chg_pct(closes), "volume": volume, "value": close * volume,
        "mcap": close * listed_shares_k * 1000 if listed_shares_k else None,
        "vol_ratio20": ind.vol_ratio(volumes), "rsi14": ind.rsi14(closes),
        "ma5": ind.sma(closes, 5), "ma20": ind.sma(closes, 20), "ma50": ind.sma(closes, 50),
        "ma60": ind.sma(closes, 60), "ma120": ind.sma(closes, 120), "std20": ind.std_pop(closes, 20),
        "ma_order": ind.ma_order_code(closes),
        "high_52w_prev": prev, "is_new_high": int(prev is not None and highs[-1] > prev),
        "gc_days": ind.gc_days(closes), "vp_above_pct": ind.vp_above_pct(highs, lows, closes, volumes),
        **{k: fin.get(k) for k in _FIN_KEYS},
        "per": ind.ratio(close, fin.get("eps")), "pbr": ind.ratio(close, fin.get("bps")),
        "liquid": int(liquid),
    }


def compute_day(as_of: date, universe: list[tuple], profiles: dict, bars: dict, fundamentals: dict) -> list[dict]:
    """universe: [(ticker, name, market)], profiles: {ticker: (시장, 업종 그룹 코드, 상장주식수(천 주), 거래정지)}
    (market_repo.group_profile_map), bars: {ticker: [(date, high, low, close, volume)]}, fundamentals: {ticker: dict}.
    기준일 봉이 없는 종목(거래정지 등)은 건너뛴다. 한 종목 오류는 그 종목만 뺀다."""
    rows: list[dict] = []
    for ticker, _name, market in universe:
        b = bars.get(ticker)
        if not b or b[-1][0] != as_of:
            continue
        p_market, sector, shares, _halted = profiles.get(ticker, (market, "", None, False))
        sector = "" if (sector or "").strip() in ("", NO_SECTOR) else sector.strip()
        try:
            rows.append(stock_row(as_of, ticker, p_market or market, sector, b, shares, fundamentals.get(ticker)))
        except Exception:  # noqa: BLE001 — 한 종목 데이터 이상이 하루 계산 전체를 막지 않게
            log.exception("스크리너 계산 실패 ticker=%s date=%s", ticker, as_of)
    return rows

"""AI Lab 정량 미리 보기 — 저장소 입출력 + 순수 함수 계산을 묶어 JSON 하나로(저장 없음·외부 AI 호출 없음).

동기 함수(CH·PG 동기 클라이언트) — 라우터는 run_in_threadpool 로 부른다.
"""
from __future__ import annotations

import logging
from datetime import date

from apps.ai_analyst.skills import quant_facts as Q
from apps.ai_analyst.skills import quant_repository as repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)


def _jsonable(v):
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


def quant_preview(ticker: str, capital: float = 10_000_000, risk_pct: float = 1.0,
                  as_of: date | None = None) -> dict | None:
    """종목 정량 팩트 묶음. 일봉이 없으면(없는 종목) None."""
    ticker = ticker.strip()
    raw = repo.load_daily_bars(ticker, as_of)
    if not raw:
        return None
    bars, split = Q.split_cut(raw)  # 수정주가 미반영 의심 점프 이전 구간은 버린다
    d = bars[-1]["date"]
    close = bars[-1]["close"]
    canslim = repo.load_canslim(ticker, d) or {}
    rs = canslim.get("l_rs")

    with SyncSessionLocal() as session:
        name = repo.load_name(session, ticker)
        profile = repo.load_profile(session, ticker) or {}
        market = profile.get("market") or canslim.get("market") or ""
        breadth_rows = repo.load_breadth_rows(session, market, d) if market else []
    sector = canslim.get("sector_m") or profile.get("sector_m") or ""

    stop = Q.suggest_stop(bars)
    try:
        position = Q.position_size(capital, risk_pct, close, stop["stop"]) if stop else None
        position_error = None
    except ValueError as e:
        position, position_error = None, str(e)

    fund = repo.load_fundamentals(ticker, as_of)
    annual = fund["annual"] or {}
    target = {"ticker": ticker, "close": close, "eps": annual.get("eps"), "bps": annual.get("bps"),
              "roe": annual.get("roe")}
    peers = repo.load_sector_peers(sector, canslim["date"], d, as_of) if sector and canslim.get("date") else []

    disclosures = repo.load_dart(ticker, as_of)
    dart = {"available": disclosures is not None, "days": 90,
            **(Q.classify_dart(disclosures) if disclosures is not None else
               {"items": [], "positive_count": 0, "negative_count": 0, "overhang": False, "fatal": False})}

    breadth = Q.compute_market_breadth(breadth_rows)
    return _jsonable({
        "ticker": ticker, "name": name, "market": market or None, "sector_m": sector or None,
        "as_of": d, "close": close, "bars_used": len(bars), "split_cut": split,
        "liquidity": {"rs": rs, "avg_value_20d": canslim.get("avg_value_20d"), "canslim_date": canslim.get("date")},
        "sepa": Q.compute_sepa_template(bars, rs),
        "backtest": Q.run_setup_backtest(bars),
        "market_breadth": {**breadth, "market": market or None, "date": d},
        "stop": stop,
        "position": position,
        "position_error": position_error,
        "dart": dart,
        "peer_valuation": {**Q.peer_valuation(target, peers), "sector_m": sector or None},
        "earnings_trend": Q.earnings_trend(fund["quarters"]),
        "annual": {k: annual.get(k) for k in ("stac_yymm", "eps", "bps", "roe", "sales_growth", "op_growth",
                                               "ni_growth", "debt_ratio")} if annual else None,
    })

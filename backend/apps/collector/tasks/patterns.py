"""차트 패턴 계산 태스크 — 일일 파이프라인 맨 끝(조건검색 뒤), 기준일 하루를 지우고 다시 적재(멱등)."""
from __future__ import annotations

import json
import logging
import time
from collections import Counter
from datetime import date

from apps.collector.celery_app import celery_app
from apps.collector.patterns import detect
from apps.collector.repositories import clickhouse_patterns as cp
from shared import market_repo
from shared.database import SyncSessionLocal

log = logging.getLogger(__name__)

MAX_FAIL_RATIO = 0.05      # 조건검색과 같은 기준 — 시도한 종목 중 이 비율 이상 실패하면 적재하지 않는다


def _universe() -> list[tuple[str, str, str]]:
    with SyncSessionLocal() as db:
        return market_repo.analysis_universe(db)


def _row(as_of: date, ticker: str, market: str, close: float, b, is_current: bool) -> dict:
    return {
        "date": as_of, "ticker": ticker, "market": market, "pattern_type": b.pattern_type,
        "rim_date": b.rim_date, "low_date": b.low_date, "low_price": b.low_price, "pivot": b.pivot,
        "depth": b.depth, "length": b.length, "is_active": 1 if b.is_active else 0,
        "is_current": 1 if is_current else 0, "breakout_date": b.breakout_date,
        "breakout_price_pct": b.breakout_price_pct, "breakout_vol_pct": b.breakout_vol_pct,
        "days_since_breakout": b.days_since_breakout, "base_count": b.base_count, "subcount": b.subcount,
        "totalcount": b.totalcount, "label": b.label, "prior_uptrend_pct": b.prior_uptrend_pct,
        "confidence": b.confidence, "points": json.dumps(list(b.points), ensure_ascii=False), "close": close,
    }


@celery_app.task(name="collector.compute_patterns")
def compute_patterns(as_of: str | None = None) -> dict:
    """기준일(기본: 일봉 최신 거래일) 차트 패턴 계산·저장 — 같은 날을 다시 돌려도 멱등(그 날짜를 지우고 넣는다)."""
    cp.ensure_patterns_table()
    universe = _universe()
    d = date.fromisoformat(as_of) if as_of else cp.latest_trading_date()
    if d is None:
        return {"skipped": "일봉 없음"}
    t0 = time.monotonic()
    bars = cp.load_bars(d, tickers=[u[0] for u in universe])
    t_load = time.monotonic() - t0

    t1 = time.monotonic()
    rows: list[dict] = []
    failed = skipped = tickers = 0
    for ticker, _name, market in universe:
        tb = bars.get(ticker)
        if not tb or tb[-1][0] != d:  # 기준일 봉이 없다(거래정지·상장 전 등)
            skipped += 1
            continue
        try:
            bases = detect(tb)
        except Exception:  # noqa: BLE001 — 종목 하나 실패가 나머지를 막지 않게
            log.exception("차트 패턴 감지 실패 ticker=%s", ticker)
            failed += 1
            continue
        tickers += 1
        close = float(tb[-1][4])
        last = len(bases) - 1
        rows.extend(_row(d, ticker, market, close, b, i == last) for i, b in enumerate(bases))
    t_detect = time.monotonic() - t1

    out = {"date": d.isoformat(), "rows": len(rows), "tickers": tickers, "failed": failed, "skipped_no_bar": skipped,
           "by_pattern": dict(Counter(r["pattern_type"] for r in rows)),
           "active": sum(1 for r in rows if r["is_current"] and r["is_active"]),
           "breakout_today": sum(1 for r in rows if r["is_current"] and r["days_since_breakout"] == 1)}
    attempted = tickers + failed
    if universe and not rows:
        out["error"] = f"차트 패턴 계산 결과 0행(대상 {len(universe)}종목, 실패 {failed}, 기준일 봉 없음 {skipped})"
    elif attempted and failed / attempted >= MAX_FAIL_RATIO:
        out["error"] = f"차트 패턴 종목 계산 실패 과다({failed}/{attempted}, 기준 {MAX_FAIL_RATIO:.0%} 이상)"
    else:
        cp.replace_day(d, rows)
    log.info("차트 패턴 계산: %s (봉 로드 %.1fs, 감지 %.1fs)", out, t_load, t_detect)
    return out

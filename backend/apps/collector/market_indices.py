"""지수·시장지표 수집 — 국내(업종 지수 API)·해외(해외 지수/환율 API). 코드 체계 '출처:심볼'.

코드는 KIS 해외지수 마스터(frgn_code.mst, 2026-10-18 확인): SPX·COMP·NDX·SOX·VIX, 환율 FX@KRW.
다우 산업(.DJI)은 마스터에서 확인되지 않아 첫 실호출로 검증 — 실패해도 이 지표만 실패로 남는다.
미 국채 금리는 KIS 코드를 확인할 수 없어 FRED(DGS10·DGS2)로 받는다.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date, timedelta

from apps.collector import market_parsers as mp
from apps.collector.repositories import clickhouse_market as chm

log = logging.getLogger(__name__)

BACKFILL_DAYS = 730
OVERLAP_DAYS = 10
CHUNK_DAYS = 100
DEFAULT_US_STOCKS = "NVDA,MU,AAPL,MSFT,TSLA"


@dataclass(frozen=True)
class IndexSpec:
    code: str
    name: str
    kind: str     # KR | OVERSEAS
    mrkt: str     # U(국내 업종) | N(해외 지수·미국 대표 종목) | X(환율)
    symbol: str
    region: str   # KR(일봉 수집 뒤) | US(07:30)


_BASE = (
    IndexSpec("KR:0001", "KOSPI", "KR", "U", "0001", "KR"),
    IndexSpec("KR:1001", "KOSDAQ", "KR", "U", "1001", "KR"),
    IndexSpec("KR:2001", "KOSPI200", "KR", "U", "2001", "KR"),
    IndexSpec("US:SPX", "S&P500", "OVERSEAS", "N", "SPX", "US"),
    IndexSpec("US:COMP", "나스닥 종합", "OVERSEAS", "N", "COMP", "US"),
    IndexSpec("US:NDX", "나스닥100", "OVERSEAS", "N", "NDX", "US"),
    IndexSpec("US:SOX", "필라델피아 반도체", "OVERSEAS", "N", "SOX", "US"),
    IndexSpec("US:VIX", "VIX", "OVERSEAS", "N", "VIX", "US"),
    IndexSpec("US:DJI", "다우존스 산업", "OVERSEAS", "N", ".DJI", "US"),
    IndexSpec("FX:USDKRW", "원/달러", "OVERSEAS", "X", "FX@KRW", "US"),
)


def index_specs(region: str | None = None) -> list[IndexSpec]:
    """기본 지표 + 미국 대표 종목(기본 + MARKET_INDEX_EXTRA, 'USSTK:' 접두어 생략 가능). region 으로 거른다."""
    raw = DEFAULT_US_STOCKS + "," + (os.getenv("MARKET_INDEX_EXTRA") or "")
    stocks: list[IndexSpec] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        sym = (item.split(":", 1)[1] if item.upper().startswith("USSTK:") else item).strip().upper()
        if sym and all(s.symbol != sym for s in stocks):
            stocks.append(IndexSpec(f"USSTK:{sym}", sym, "OVERSEAS", "N", sym, "US"))
    return [s for s in (*_BASE, *stocks) if region is None or s.region == region]


def _chunks(start: date, end: date, span: int) -> list[tuple[date, date]]:
    out, cur = [], start
    while cur <= end:
        nxt = min(cur + timedelta(days=span - 1), end)
        out.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    return out


def _fetch(spec: IndexSpec, client, start: date, end: date) -> list[dict]:
    s, e = start.strftime("%Y%m%d"), end.strftime("%Y%m%d")
    if spec.kind == "KR":
        return mp.parse_domestic_index(client.get_domestic_index_daily(spec.symbol, s, e))
    return mp.parse_overseas_daily(client.get_overseas_daily(spec.mrkt, spec.symbol, s, e))


def collect_indices(specs: list[IndexSpec], client, today: date | None = None) -> dict:
    """지표마다: 저장된 최근 날짜가 없으면 2년 백필, 있으면 10일 겹쳐 재수집(멱등). 지표별 실패 격리."""
    today = today or date.today()
    ok, failed, inserted = [], [], 0
    for spec in specs:
        try:
            latest = chm.latest_index_date(spec.code)
            start = today - timedelta(days=BACKFILL_DAYS) if latest is None else latest - timedelta(days=OVERLAP_DAYS)
            rows: dict[date, dict] = {}
            for a, b in _chunks(start, today, CHUNK_DAYS):
                for r in _fetch(spec, client, a, b):
                    rows[r["date"]] = r
            inserted += chm.upsert_index_daily(spec.code, [rows[d] for d in sorted(rows)])
            ok.append(spec.code)
        except Exception as e:  # noqa: BLE001 — 지표 하나 실패가 나머지를 막지 않게
            log.warning("지수 수집 실패 %s(%s): %s", spec.code, spec.name, str(e)[:160])
            failed.append({"code": spec.code, "error": repr(e)[:300]})
    log.info("지수 수집: ok=%d failed=%d inserted=%d", len(ok), len(failed), inserted)
    return {"ok": ok, "failed": failed, "inserted": inserted}

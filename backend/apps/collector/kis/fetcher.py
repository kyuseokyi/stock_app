"""KIS 원시 응답 → 도메인 OHLCV 변환 (필드매핑).

KIS output2 행(문자열 필드) → 정규화된 dict(날짜 오름차순).
수집(client)과 변환(fetcher)을 분리해 KIS↔Mock 교체가 쉽도록 한다.
"""

from __future__ import annotations

from datetime import date

from apps.collector.kis.client import KISClient


def _to_ohlcv(row: dict) -> dict:
    """KIS output2 한 행 → OHLCV dict."""
    d = row["stck_bsop_date"]  # YYYYMMDD
    return {
        "date": date(int(d[:4]), int(d[4:6]), int(d[6:8])),
        "open": float(row["stck_oprc"]),
        "high": float(row["stck_hgpr"]),
        "low": float(row["stck_lwpr"]),
        "close": float(row["stck_clpr"]),
        "volume": int(row["acml_vol"]),
    }


def fetch_domestic_daily(
    ticker: str, start_yyyymmdd: str, end_yyyymmdd: str, client: KISClient | None = None
) -> list[dict]:
    """국내 일봉을 수집해 날짜 오름차순 OHLCV 리스트로 반환.

    KIS는 최신→과거 순으로 주므로 오름차순으로 뒤집는다. 빈 필드 행은 건너뛴다.
    """
    client = client or KISClient()
    raw = client.get_daily_ohlcv(ticker, start_yyyymmdd, end_yyyymmdd)
    out: list[dict] = []
    for row in raw:
        if not row.get("stck_bsop_date") or not row.get("stck_clpr"):
            continue  # 휴장/빈 행 스킵
        out.append(_to_ohlcv(row))
    out.sort(key=lambda r: r["date"])
    return out

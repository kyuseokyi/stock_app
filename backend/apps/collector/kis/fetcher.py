"""KIS 원시 응답 → 도메인 OHLCV 변환 (필드매핑).

KIS output2 행(문자열 필드) → 정규화된 dict(날짜 오름차순).
수집(client)과 변환(fetcher)을 분리해 KIS↔Mock 교체가 쉽도록 한다.
"""

from __future__ import annotations

from datetime import date, timedelta

from apps.collector.kis.client import KISClient

# KIS 일봉은 1회 호출 최대 ~100행(거래일). 100 캘린더일 ≈ 68~72 거래일이라 안전.
_CHUNK_SPAN_DAYS = 100


def _parse_yyyymmdd(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def _fmt_yyyymmdd(d: date) -> str:
    return d.strftime("%Y%m%d")


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


def _chunk_ranges(start: date, end: date, span_days: int = _CHUNK_SPAN_DAYS):
    """[start, end] 를 span_days 크기의 연속 구간으로 분할."""
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=span_days - 1), end)
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)


def fetch_domestic_daily_range(
    ticker: str,
    start_yyyymmdd: str,
    end_yyyymmdd: str,
    client: KISClient | None = None,
    span_days: int = _CHUNK_SPAN_DAYS,
) -> list[dict]:
    """긴 기간을 청킹 수집해 전체 일봉을 날짜 오름차순으로 반환.

    KIS 100행/호출 제한을 우회하기 위해 구간을 나눠 여러 번 호출하고,
    날짜 기준으로 병합·중복제거한다. 백필(장기 히스토리) 용도.
    """
    client = client or KISClient()
    start = _parse_yyyymmdd(start_yyyymmdd)
    end = _parse_yyyymmdd(end_yyyymmdd)
    merged: dict[date, dict] = {}
    for s, e in _chunk_ranges(start, end, span_days):
        for row in fetch_domestic_daily(ticker, _fmt_yyyymmdd(s), _fmt_yyyymmdd(e), client=client):
            merged[row["date"]] = row  # 겹침 구간은 최신 호출값으로 대체(동일값)
    return [merged[d] for d in sorted(merged)]

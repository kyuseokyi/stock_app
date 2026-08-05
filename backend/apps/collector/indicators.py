"""수집 시 저장할 기본 지표 계산.

Phase 1 저장 대상: MA5/20/50/120 (종가 SMA).
파생 지표(볼린저 σ가변·정배열/역배열·매물대)는 stock_api가 조회 시 계산하므로 여기서 저장하지 않는다.
"""

from __future__ import annotations

import pandas as pd

_MA_WINDOWS = (5, 20, 50, 120)


def enrich_with_ma(ohlcv: list[dict]) -> list[dict]:
    """OHLCV 리스트(날짜 오름차순)에 ma5/20/50/120 컬럼을 추가해 반환.

    구간이 부족한 초기 구간의 MA는 None.
    """
    if not ohlcv:
        return []
    df = pd.DataFrame(ohlcv)
    for w in _MA_WINDOWS:
        col = df["close"].rolling(window=w, min_periods=w).mean().round(4)
        df[f"ma{w}"] = col
    records = df.to_dict("records")
    # NaN → None 정규화
    for rec in records:
        for w in _MA_WINDOWS:
            key = f"ma{w}"
            if pd.isna(rec[key]):
                rec[key] = None
    return records

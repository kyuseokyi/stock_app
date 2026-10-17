"""수집 시 저장할 기본 지표 계산.

Phase 1 저장 대상: MA5/20/50/120 (종가 SMA).
파생 지표(볼린저 σ가변·정배열/역배열·매물대)는 stock_api가 조회 시 계산하므로 여기서 저장하지 않는다.
"""

from __future__ import annotations

import pandas as pd

_MA_WINDOWS = (5, 20, 50, 120)


# 겹침창 수집(30일)에서 MA120 을 이어 계산하려면 직전 119개 종가가 필요하다
HISTORY_BARS = max(_MA_WINDOWS) - 1


def enrich_with_ma(ohlcv: list[dict], history: list[float] | None = None) -> list[dict]:
    """OHLCV 리스트(날짜 오름차순)에 ma5/20/50/120 컬럼을 추가해 반환.

    history: ohlcv 첫 날짜 이전 종가(오름차순, 최대 HISTORY_BARS 개면 충분) — 앞에 이어 붙여 계산하고
    결과에서는 뺀다. 매일 겹침창(30일) 수집이 ma50/120 을 None 으로 덮어쓰지 않게(ReplacingMergeTree).
    구간이 부족한 초기 구간의 MA는 None.
    """
    if not ohlcv:
        return []
    df = pd.DataFrame(ohlcv)
    prefix = len(history or [])
    closes = pd.concat([pd.Series(history or [], dtype="float64"), df["close"].astype("float64")], ignore_index=True)
    for w in _MA_WINDOWS:
        col = closes.rolling(window=w, min_periods=w).mean().round(4)
        df[f"ma{w}"] = col.iloc[prefix:].reset_index(drop=True)
    records = df.to_dict("records")
    # NaN → None 정규화
    for rec in records:
        for w in _MA_WINDOWS:
            key = f"ma{w}"
            if pd.isna(rec[key]):
                rec[key] = None
    return records

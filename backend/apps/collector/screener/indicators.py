"""스크리너 지표 — 순수 함수. 입력은 오래된 → 최신 순 목록, 데이터가 모자라면 None.

정의는 기존 화면·게임과 같게 맞춘다(테스트로 고정):
RSI = trading_game rsi_service.wilder_rsi(최근 100종가), 배열 = stock_api chart.ma_order,
매물대 구간 = chart.volume_profile, 골든크로스 = trading_game indicators.golden_cross_within.
"""
from __future__ import annotations

import math
from typing import Sequence

from apps.trading_game.services.rsi_service import wilder_rsi

RSI_PERIOD = 14
RSI_LOOKBACK = 100          # 게임 rsi_service.CLOSES_LOOKBACK 과 같은 길이(Wilder 평활은 입력 길이에 따라 값이 조금 다름)
VOL_AVG_DAYS = 20
HIGH_LOOKBACK = 251         # 직전 251거래일 + 당일 = 52주
GC_FAST, GC_SLOW, GC_WITHIN = 20, 60, 3
VP_BARS, VP_BINS = 120, 20


def sma(values: Sequence[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def std_pop(values: Sequence[float], n: int = 20) -> float | None:
    """마지막 n개 모집단 표준편차(chart.bollinger_bands 와 같은 정의)."""
    if len(values) < n:
        return None
    window = values[-n:]
    m = sum(window) / n
    return math.sqrt(sum((x - m) ** 2 for x in window) / n)


def rsi14(closes: Sequence[float]) -> float | None:
    return wilder_rsi(list(closes[-RSI_LOOKBACK:]), RSI_PERIOD)


def chg_pct(closes: Sequence[float]) -> float | None:
    if len(closes) < 2 or not closes[-2]:
        return None
    return closes[-1] / closes[-2] * 100 - 100


def vol_ratio(volumes: Sequence[float], n: int = VOL_AVG_DAYS) -> float | None:
    """당일 거래량 / 직전 n거래일 평균(당일 제외). 평균이 0 이면 None."""
    if len(volumes) < n + 1:
        return None
    avg = sum(volumes[-n - 1:-1]) / n
    return volumes[-1] / avg if avg > 0 else None


def ma_order_code(closes: Sequence[float]) -> int:
    """1 정배열(MA5>20>50>120) · -1 역배열 · 0 혼합·판정 불가. chart.ma_order 처럼 소수 둘째 자리 반올림 후 비교."""
    vals = [sma(closes, n) for n in (5, 20, 50, 120)]
    if any(v is None for v in vals):
        return 0
    m5, m20, m50, m120 = (round(v, 2) for v in vals)
    if m5 > m20 > m50 > m120:
        return 1
    if m5 < m20 < m50 < m120:
        return -1
    return 0


def prev_high(highs: Sequence[float], n: int = HIGH_LOOKBACK) -> float | None:
    """당일을 뺀 직전 n거래일 최고가. 봉이 n+1개 미만이면 None."""
    if len(highs) < n + 1:
        return None
    return max(highs[-n - 1:-1])


def gc_days(closes: Sequence[float], fast: int = GC_FAST, slow: int = GC_SLOW, within: int = GC_WITHIN) -> int | None:
    """MA(fast) 가 MA(slow) 를 아래→위로 뚫은 뒤 지난 거래일 수(0 = 오늘). 오늘 포함 마지막 within 봉 안의 교차만 보고,
    지금도 fast > slow 여야 한다(golden_cross_within 과 같은 판정). 없거나 데이터 부족이면 None."""
    if len(closes) < slow + within:
        return None

    def ma(end: int, n: int) -> float:
        return sum(closes[end - n + 1:end + 1]) / n

    last = len(closes) - 1
    if not ma(last, fast) > ma(last, slow):
        return None
    for i in range(last, last - within, -1):
        if ma(i - 1, fast) <= ma(i - 1, slow) and ma(i, fast) > ma(i, slow):
            return last - i
    return None


def _bucket(price: float, p_min: float, width: float, bins: int) -> int:
    return max(0, min(bins - 1, int((price - p_min) / width)))


def volume_buckets(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
                   volumes: Sequence[float], bins: int = VP_BINS) -> list[float]:
    """가격 구간별 거래량(chart.volume_profile 과 같은 규칙 — 종가가 든 구간에 그날 거래량을 더한다)."""
    if not closes:
        return []
    p_min, p_max = min(lows), max(highs)
    if p_max <= p_min:
        return [float(sum(volumes))]
    width = (p_max - p_min) / bins
    buckets = [0.0] * bins
    for c, v in zip(closes, volumes):
        buckets[_bucket(c, p_min, width, bins)] += v
    return buckets


def vp_above_pct(highs: Sequence[float], lows: Sequence[float], closes: Sequence[float],
                 volumes: Sequence[float], bars: int = VP_BARS, bins: int = VP_BINS) -> float | None:
    """최근 bars 봉 매물대에서 현재가가 든 구간보다 위 구간의 거래량 비율(%). 현재가 구간은 넣지 않는다."""
    if len(closes) < bars:
        return None
    h, lo, c, v = highs[-bars:], lows[-bars:], closes[-bars:], volumes[-bars:]
    total = sum(v)
    if total <= 0:
        return None
    p_min, p_max = min(lo), max(h)
    if p_max <= p_min:
        return 0.0
    buckets = volume_buckets(h, lo, c, v, bins)
    idx = _bucket(c[-1], p_min, (p_max - p_min) / bins, bins)
    return sum(buckets[idx + 1:]) / total * 100


def ratio(price: float, per_share: float | None) -> float | None:
    """PER·PBR = 종가 / 주당 값. 주당 값이 없거나 0 이하면 None(적자·자본잠식은 배수 의미 없음)."""
    if per_share is None or per_share <= 0:
        return None
    return price / per_share

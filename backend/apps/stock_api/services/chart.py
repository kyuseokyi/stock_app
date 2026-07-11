"""온더플라이(on-the-fly) OHLCV 생성 서비스.

DB에 저장하지 않고 요청 시점에 `symbol + 날짜`를 시드로 삼아 결정적으로
가짜 일봉 데이터를 생성한다. 같은 종목·기간이면 항상 동일한 결과가 나온다.
실데이터 전환 시 `generate_candles` 만 ClickHouse 조회/KIS 페칭으로 교체하면 된다.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import date, timedelta

from apps.stock_api.seed_catalog import SeedStock, get_by_symbol


@dataclass(frozen=True)
class Candle:
    date: str  # YYYY-MM-DD
    open: float
    high: float
    low: float
    close: float
    volume: int


# 시장/통화별 기준 시작가 (표시 스케일 자연스럽게)
_BASE_PRICE = {
    "KRW": 65000.0,
    "USD": 180.0,
    "PT": 3200.0,  # 지수 포인트
}


def _seed_int(*parts: str) -> int:
    """문자열 조합으로 결정적 정수 시드 생성."""
    h = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return int(h[:12], 16)


def _rand01(*parts: str) -> float:
    """0~1 결정적 난수 (외부 상태 없음)."""
    return (_seed_int(*parts) % 1_000_003) / 1_000_003.0


def _daterange(start: date, end: date):
    """주말 제외 영업일만 순회."""
    d = start
    while d <= end:
        if d.weekday() < 5:  # 월~금
            yield d
        d += timedelta(days=1)


def generate_candles(symbol: str, start_date: str, end_date: str) -> list[Candle]:
    """기간 내 결정적 OHLCV 생성. 잘못된 심볼/기간이면 빈 리스트."""
    stock = get_by_symbol(symbol)
    if stock is None:
        return []

    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        return []
    if start > end:
        return []

    base = _BASE_PRICE.get(stock.currency, 100.0)
    # 종목별 시작가에 편차를 줘 서로 다른 레벨에서 출발
    price = base * (0.6 + 1.2 * _rand01(symbol, "base"))
    drift = (_rand01(symbol, "drift") - 0.45) * 0.004  # 종목별 완만한 추세

    candles: list[Candle] = []
    for i, d in enumerate(_daterange(start, end)):
        key = d.isoformat()
        # 일별 변동률: 추세 + 사인 파동 + 결정적 노이즈
        noise = (_rand01(symbol, key) - 0.5) * 0.04
        wave = math.sin(i / 7.0) * 0.006
        change = drift + wave + noise

        prev_close = price
        open_ = prev_close * (1 + (_rand01(symbol, key, "o") - 0.5) * 0.01)
        close = max(base * 0.05, prev_close * (1 + change))
        high = max(open_, close) * (1 + _rand01(symbol, key, "h") * 0.012)
        low = min(open_, close) * (1 - _rand01(symbol, key, "l") * 0.012)
        vol_base = 30_000 if stock.currency == "PT" else 1_000_000
        volume = int(vol_base * (0.4 + 1.6 * _rand01(symbol, key, "v")))

        digits = 2 if stock.currency != "KRW" else 0
        candles.append(
            Candle(
                date=key,
                open=round(open_, digits),
                high=round(high, digits),
                low=round(low, digits),
                close=round(close, digits),
                volume=volume,
            )
        )
        price = close

    return candles


def moving_average(candles: list[Candle], window: int) -> list[float | None]:
    """종가 기준 단순이동평균. 초기 구간은 None."""
    out: list[float | None] = []
    closes = [c.close for c in candles]
    for i in range(len(closes)):
        if i < window - 1:
            out.append(None)
        else:
            out.append(round(sum(closes[i - window + 1 : i + 1]) / window, 2))
    return out


@dataclass(frozen=True)
class BollingerBand:
    period: int
    std_dev: float  # 표준편차 배수 (bbStdDev)
    mid: list[float | None]
    upper: list[float | None]
    lower: list[float | None]


@dataclass(frozen=True)
class VolumeProfileBin:
    price_low: float
    price_high: float
    volume: int


def bollinger_bands(
    candles: list[Candle], period: int = 20, std_dev: float = 2.0
) -> BollingerBand:
    """볼린저 밴드. 중심선=SMA(period), 상/하단=중심 ± std_dev*σ.

    std_dev(bbStdDev)를 인자로 받아 밴드 폭을 동적으로 계산한다.
    """
    closes = [c.close for c in candles]
    mid: list[float | None] = []
    upper: list[float | None] = []
    lower: list[float | None] = []
    for i in range(len(closes)):
        if i < period - 1:
            mid.append(None)
            upper.append(None)
            lower.append(None)
            continue
        window = closes[i - period + 1 : i + 1]
        m = sum(window) / period
        var = sum((x - m) ** 2 for x in window) / period
        sigma = math.sqrt(var)
        mid.append(round(m, 2))
        upper.append(round(m + std_dev * sigma, 2))
        lower.append(round(m - std_dev * sigma, 2))
    return BollingerBand(
        period=period, std_dev=std_dev, mid=mid, upper=upper, lower=lower
    )


def ma_order(candles: list[Candle]) -> str:
    """최신 시점의 이동평균선 배열 상태.

    정배열(PERFECT): MA5 > MA20 > MA50 > MA120
    역배열(REVERSE): MA5 < MA20 < MA50 < MA120
    그 외: MIXED (판정 불가/혼조 포함)
    """
    def last(window: int) -> float | None:
        vals = moving_average(candles, window)
        return vals[-1] if vals else None

    m5, m20, m50, m120 = last(5), last(20), last(50), last(120)
    if None in (m5, m20, m50, m120):
        return "MIXED"
    if m5 > m20 > m50 > m120:
        return "PERFECT"
    if m5 < m20 < m50 < m120:
        return "REVERSE"
    return "MIXED"


def volume_profile(candles: list[Candle], bins: int = 20) -> list[VolumeProfileBin]:
    """가격대별 누적 거래량(매물대). 각 캔들 거래량을 종가가 속한 가격 구간에 합산."""
    if not candles:
        return []
    lows = [c.low for c in candles]
    highs = [c.high for c in candles]
    p_min, p_max = min(lows), max(highs)
    if p_max <= p_min:
        return [VolumeProfileBin(p_min, p_max, sum(c.volume for c in candles))]

    width = (p_max - p_min) / bins
    buckets = [0] * bins
    for c in candles:
        idx = int((c.close - p_min) / width)
        idx = max(0, min(bins - 1, idx))
        buckets[idx] += c.volume

    digits = 2 if any(c.close < 1000 for c in candles) else 0
    return [
        VolumeProfileBin(
            price_low=round(p_min + i * width, digits),
            price_high=round(p_min + (i + 1) * width, digits),
            volume=buckets[i],
        )
        for i in range(bins)
    ]


def resolve_stock(symbol: str) -> SeedStock | None:
    return get_by_symbol(symbol)

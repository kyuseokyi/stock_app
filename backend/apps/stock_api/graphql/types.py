"""GraphQL Object Types (Strawberry)."""

from __future__ import annotations

import strawberry


@strawberry.type
class Stock:
    """종목/지수 검색 결과 항목."""

    symbol: str
    name: str
    market: str  # KOSPI/KOSDAQ/NASDAQ/NYSE/INDEX
    country: str  # KR/US/GLOBAL
    currency: str  # KRW/USD/PT


@strawberry.type
class Candle:
    """일봉 OHLCV."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


@strawberry.type
class BollingerBand:
    """볼린저 밴드. std_dev(bbStdDev) 배수를 적용한 상/하단 밴드."""

    period: int
    std_dev: float
    mid: list[float | None]
    upper: list[float | None]
    lower: list[float | None]


@strawberry.type
class VolumeProfileBin:
    """매물대 — 가격 구간별 누적 거래량."""

    price_low: float
    price_high: float
    volume: int


@strawberry.type
class ChartData:
    """종목 차트 응답. 클라이언트가 필요한 필드만 선택 조회."""

    symbol: str
    name: str
    market: str
    currency: str
    candles: list[Candle]
    ma5: list[float | None]
    ma20: list[float | None]
    ma50: list[float | None]
    ma120: list[float | None]
    # 정배열(PERFECT) / 역배열(REVERSE) / 혼조(MIXED)
    ma_order: str
    bollinger: BollingerBand
    volume_profile: list[VolumeProfileBin]


# ---------------------------------------------------------------- CANSLIM (스크리너 프로젝트 2)
# 항목 상태: 1 통과 · 0 미달 · -1 데이터 부족 · -2 준비 중


@strawberry.type
class CanslimMarket:
    """시장(KOSPI/KOSDAQ) 방향 — M 항목·배너."""

    market: str
    date: str
    status: str  # 상승 추세 | 조정 | 하락
    close: float
    ma50: float
    ma200: float
    distribution_days: int


@strawberry.type
class CanslimLetters:
    c: int
    a: int
    n: int
    s: int
    l: int  # noqa: E741
    i: int
    m: int


@strawberry.type
class CanslimItem:
    ticker: str
    name: str
    market: str
    sector_name: str | None
    close: float
    score: int
    pass_count: int
    liquid: bool
    letters: CanslimLetters
    rs: int | None
    pct_from_high: float | None


@strawberry.type
class CanslimScreen:
    date: str | None  # 계산된 날이 없으면 null(준비 중)
    total: int
    items: list[CanslimItem]


@strawberry.type
class CanslimLetter:
    key: str  # c a n s l i m
    status: int
    value: float | None
    display: str  # 근거 수치 한 줄(예: "+32.5% (2026년 6월 분기)")
    threshold: str
    label: str
    explanation: str


@strawberry.type
class CanslimHistoryPoint:
    date: str
    score: int
    pass_count: int


@strawberry.type
class CanslimScore:
    date: str
    ticker: str
    name: str
    market: str
    sector_name: str | None
    close: float
    score: int
    pass_count: int
    letters: list[CanslimLetter]
    history: list[CanslimHistoryPoint]
    market_status: str | None

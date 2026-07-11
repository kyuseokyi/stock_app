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
class ChartData:
    """종목 차트 응답. 클라이언트가 필요한 필드만 선택 조회."""

    symbol: str
    name: str
    market: str
    currency: str
    candles: list[Candle]
    ma5: list[float | None]
    ma20: list[float | None]

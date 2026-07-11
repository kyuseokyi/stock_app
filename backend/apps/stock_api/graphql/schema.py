"""GraphQL 스키마 — searchStocks / getChartData 리졸버."""

from __future__ import annotations

import strawberry

from apps.stock_api.graphql.types import Candle, ChartData, Stock
from apps.stock_api.seed_catalog import search as catalog_search
from apps.stock_api.services import chart as chart_service


@strawberry.type
class Query:
    @strawberry.field(description="국내·해외 주식 및 주요 지수 통합 검색")
    def search_stocks(self, query: str) -> list[Stock]:
        return [
            Stock(
                symbol=s.symbol,
                name=s.name,
                market=s.market,
                country=s.country,
                currency=s.currency,
            )
            for s in catalog_search(query)
        ]

    @strawberry.field(description="종목/지수의 기간별 OHLCV 및 이동평균 조회")
    def get_chart_data(
        self, symbol: str, start_date: str, end_date: str
    ) -> ChartData | None:
        stock = chart_service.resolve_stock(symbol)
        if stock is None:
            return None

        candles = chart_service.generate_candles(symbol, start_date, end_date)
        ma5 = chart_service.moving_average(candles, 5)
        ma20 = chart_service.moving_average(candles, 20)

        return ChartData(
            symbol=stock.symbol,
            name=stock.name,
            market=stock.market,
            currency=stock.currency,
            candles=[
                Candle(
                    date=c.date,
                    open=c.open,
                    high=c.high,
                    low=c.low,
                    close=c.close,
                    volume=c.volume,
                )
                for c in candles
            ],
            ma5=ma5,
            ma20=ma20,
        )


schema = strawberry.Schema(query=Query)

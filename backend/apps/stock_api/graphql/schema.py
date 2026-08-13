"""GraphQL 스키마 — searchStocks / getChartData 리졸버."""

from __future__ import annotations

from datetime import date, timedelta

import strawberry

from apps.stock_api.graphql.types import (
    BollingerBand,
    Candle,
    ChartData,
    Stock,
    VolumeProfileBin,
)
from apps.stock_api.seed_catalog import search as catalog_search
from apps.stock_api.services import chart as chart_service
from apps.stock_api.services import clickhouse_source as ch_source
from shared import stock_meta_repo
from shared.database import SyncSessionLocal

# MA120 등 장기 지표를 표시 시작일부터 그리려면 그 이전 거래일이 필요하다.
# 200 캘린더일 ≈ 140 거래일 > 120 → 표시 구간 첫날부터 MA120 산출 가능.
_LOOKBACK_DAYS = 200


def _lookback_start(start_date: str) -> str:
    """표시 시작일에서 lookback 버퍼만큼 앞당긴 조회 시작일."""
    try:
        d = date.fromisoformat(start_date)
    except ValueError:
        return start_date
    return (d - timedelta(days=_LOOKBACK_DAYS)).isoformat()


def _display_start_index(candles: list, start_date: str) -> int:
    """표시 시작일 이상인 첫 캔들의 인덱스(없으면 0)."""
    for i, c in enumerate(candles):
        if c.date >= start_date:
            return i
    return 0


@strawberry.type
class Query:
    @strawberry.field(description="국내·해외 주식 및 주요 지수 통합 검색")
    def search_stocks(self, query: str) -> list[Stock]:
        # 국내는 stock_meta(단일 마스터), 미국/지수는 seed_catalog 하이브리드
        results: list[Stock] = []
        with SyncSessionLocal() as db:
            for m in stock_meta_repo.search_active(db, query):
                results.append(
                    Stock(
                        symbol=m.ticker,
                        name=m.name,
                        market=m.market.value,
                        country="KR",
                        currency="KRW",
                    )
                )
        seen = {r.symbol for r in results}
        for s in catalog_search(query):
            if s.country != "KR" and s.symbol not in seen:  # 미국/지수만 seed에서
                results.append(
                    Stock(
                        symbol=s.symbol,
                        name=s.name,
                        market=s.market,
                        country=s.country,
                        currency=s.currency,
                    )
                )
        return results

    @strawberry.field(
        description="종목/지수의 기간별 OHLCV·이동평균·정배열/역배열·볼린저밴드·매물대 조회"
    )
    def get_chart_data(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        bb_std_dev: float = 2.0,
    ) -> ChartData | None:
        stock = chart_service.resolve_stock(symbol)
        if stock is None:
            return None

        # 하이브리드: 수집된 종목이면 ClickHouse 실데이터, 없으면 온더플라이 시드.
        # 실데이터는 표시 시작일 이전 lookback 버퍼까지 가져와 MA120 등을 표시 첫날부터 산출.
        candles = ch_source.get_candles(symbol, _lookback_start(start_date), end_date)
        if candles:
            i0 = _display_start_index(candles, start_date)
        else:
            # 온더플라이(가짜)는 버퍼 없이 표시 구간 그대로(누적 워크라 시작 변경 시 값이 달라짐)
            candles = chart_service.generate_candles(symbol, start_date, end_date)
            i0 = 0

        # 지표는 확장 시계열 전체로 계산 → 표시 구간(i0:)만 잘라 반환
        ma5 = chart_service.moving_average(candles, 5)
        ma20 = chart_service.moving_average(candles, 20)
        ma50 = chart_service.moving_average(candles, 50)
        ma120 = chart_service.moving_average(candles, 120)
        order = chart_service.ma_order(candles)  # 최신값 기준(트림 무관)
        bb = chart_service.bollinger_bands(candles, period=20, std_dev=bb_std_dev)

        candles_disp = candles[i0:]
        vp = chart_service.volume_profile(candles_disp)  # 매물대는 표시 구간 기준

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
                for c in candles_disp
            ],
            ma5=ma5[i0:],
            ma20=ma20[i0:],
            ma50=ma50[i0:],
            ma120=ma120[i0:],
            ma_order=order,
            bollinger=BollingerBand(
                period=bb.period,
                std_dev=bb.std_dev,
                mid=bb.mid[i0:],
                upper=bb.upper[i0:],
                lower=bb.lower[i0:],
            ),
            volume_profile=[
                VolumeProfileBin(
                    price_low=b.price_low,
                    price_high=b.price_high,
                    volume=b.volume,
                )
                for b in vp
            ],
        )


schema = strawberry.Schema(query=Query)

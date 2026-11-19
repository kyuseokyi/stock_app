"""GraphQL 스키마 — searchStocks / getChartData 리졸버.

A안(시세 비노출): 시세를 내주는 리졸버는 _market_ok(info) 가 거짓이면 오류 대신 빈 값(빈 목록·null·빈 캔들)을 돌려준다 —
설치된 옛 앱이 죽지 않게(설계 2-3). 판정은 services/market_access(스위치 ON·관리자·열람 권한 회원).
"""

from __future__ import annotations

from datetime import date, timedelta

import strawberry
from fastapi.concurrency import run_in_threadpool

from apps.stock_api.graphql.types import (
    BollingerBand,
    Candle,
    CanslimHistoryPoint,
    CanslimItem,
    CanslimLetter,
    CanslimLetters,
    CanslimMarket,
    CanslimScore,
    CanslimScreen,
    CalendarEvent,
    ChartData,
    GroupDetail,
    GroupHistory,
    GroupItem,
    GroupLeader,
    GroupRanking,
    GroupStock,
    MacroValue,
    MarketIndex,
    MarketOverview,
    PatternBase,
    PatternBases,
    PatternItem,
    PatternPoint,
    PatternScreen,
    PatternZones,
    ScreenerFeatures,
    ScreenerFilterInput,
    ScreenerItem,
    ScreenerScreen,
    Stock,
    Treemap,
    TreemapGroup,
    TreemapStock,
    VolumeProfileBin,
)
from apps.stock_api.seed_catalog import search as catalog_search
from apps.stock_api.services import canslim_query
from apps.stock_api.services import market_access
from apps.stock_api.services import market_query
from apps.stock_api.services import pattern_query
from apps.stock_api.services import screener_features
from apps.stock_api.services import screener_query
from apps.stock_api.services import chart as chart_service
from apps.stock_api.services import clickhouse_source as ch_source
from shared import stock_meta_repo
from shared.clickhouse_schema import market_data_readonly
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


def _market_ok(info: strawberry.Info) -> bool:
    """이 요청이 시세를 볼 수 있는가(라우터 context 의 판정, 없으면 스위치만)."""
    return market_access.context_allowed(info.context)


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
        info: strawberry.Info,
        symbol: str,
        start_date: str,
        end_date: str,
        bb_std_dev: float = 2.0,
        # true 면 실데이터가 없을 때 가짜 캔들 대신 빈 candles — 차트 과거 이어 불러오기의 '더 없음' 판단용
        real_only: bool = False,
    ) -> ChartData | None:
        stock = chart_service.resolve_stock(symbol)
        if stock is None:
            return None

        # 하이브리드: 수집된 종목이면 ClickHouse 실데이터, 없으면 온더플라이 시드.
        # 실데이터는 표시 시작일 이전 lookback 버퍼까지 가져와 MA120 등을 표시 첫날부터 산출.
        if not _market_ok(info):
            # 시세 비노출 — 종목 정보만 두고 빈 캔들(지표 함수는 빈 목록 허용)
            candles, i0 = [], 0
        elif candles := ch_source.get_candles(symbol, _lookback_start(start_date), end_date):
            i0 = _display_start_index(candles, start_date)
            if real_only and candles[i0].date < start_date:
                candles, i0 = [], 0  # 표시 구간엔 없고 앞쪽 버퍼에만 있음 → 이 구간은 비어 있다
        elif real_only or market_data_readonly():
            # 보관 기간보다 과거 — 가짜를 붙이지 않고 빈 구간으로 돌려준다(지표 함수는 빈 목록 허용).
            # prod_readonly 개발 서버: 터널이 끊기면 get_candles 가 None 이라 가짜 시드가 정상 차트처럼 보인다 →
            # 빈 차트로 장애를 드러낸다(상용·로컬은 설정이 없어 지금 동작 그대로).
            candles, i0 = [], 0
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

    # ------------------------------------------------------------ CANSLIM (공개)
    @strawberry.field(description="CANSLIM 시장 방향(M) — 최신 기준일 KOSPI·KOSDAQ")
    def canslim_market(self, info: strawberry.Info) -> list[CanslimMarket]:
        if not _market_ok(info):
            return []
        return [CanslimMarket(**m) for m in canslim_query.markets()]

    @strawberry.field(description="CANSLIM 스크리너 목록 — 최신 기준일, 필터·정렬")
    def canslim_screen(
        self,
        info: strawberry.Info,
        market: str = "ALL",
        min_pass: int = 0,
        required: list[str] | None = None,
        sort: str = "score",
        liquid_only: bool = True,
        limit: int = 50,
        offset: int = 0,
        near_ath: bool = False,
    ) -> CanslimScreen:
        if not _market_ok(info):
            return CanslimScreen(date=None, total=0, items=[])
        out = canslim_query.screen(market=market, min_pass=min_pass, required=required, sort=sort,
                                   liquid_only=liquid_only, limit=limit, offset=offset, near_ath=near_ath)
        items = [CanslimItem(**{**it, "letters": CanslimLetters(**it["letters"])}) for it in out["items"]]
        return CanslimScreen(date=out["date"], total=out["total"], items=items)

    @strawberry.field(description="CANSLIM 종목 점수표 — 7항목 판정·근거·최근 60거래일 추이(분석 대상 아니면 null)")
    def canslim_score(self, info: strawberry.Info, ticker: str) -> CanslimScore | None:
        if not _market_ok(info):
            return None
        out = canslim_query.score(ticker)
        if out is None:
            return None
        return CanslimScore(
            **{**out, "letters": [CanslimLetter(**x) for x in out["letters"]],
               "history": [CanslimHistoryPoint(**h) for h in out["history"]]}
        )

    # ------------------------------------------------------------ 조건검색 (공개)
    @strawberry.field(description="조건검색 — 프리셋(volume_surge·golden_cross·oversold·new_high·foreign_buy_5d·"
                                  "double_buy_new_high·pension_buy_10d·lending_drop·ma5_20)과 필터(AND), "
                                  "최신 기준일. sort: value|volume|chg|vol_ratio|rsi|mcap|vp_above|spread_5_20")
    def screener_screen(
        self,
        info: strawberry.Info,
        preset: str | None = None,
        filters: ScreenerFilterInput | None = None,
        sort: str = "value",
        limit: int = 50,
        offset: int = 0,
    ) -> ScreenerScreen:
        if not _market_ok(info):
            return ScreenerScreen(date=None, total=0, bb_sigma=screener_query.bb_sigma(dict(vars(filters)) if filters else {}),
                                  items=[])
        out = screener_query.screen(preset=preset, filters=dict(vars(filters)) if filters else {}, sort=sort,
                                    limit=limit, offset=offset)
        return ScreenerScreen(date=out["date"], total=out["total"], bb_sigma=out["bb_sigma"],
                              items=[ScreenerItem(**it) for it in out["items"]])

    # ------------------------------------------------------------ 차트 패턴 (공개)
    @strawberry.field(description="차트 패턴 목록 — report: breakout_today|recent_breakouts|near_pivot|forming, "
                                  "sort: pivot_dist|breakout_vol|depth|length")
    def pattern_screen(
        self,
        info: strawberry.Info,
        report: str = "forming",
        pattern_type: str | None = None,
        market: str | None = None,
        sort: str = "pivot_dist",
        limit: int = 50,
        offset: int = 0,
    ) -> PatternScreen:
        if not _market_ok(info):
            return PatternScreen(date=None, total=0, items=[])
        out = pattern_query.screen(report=report, pattern_type=pattern_type, market=market, sort=sort, limit=limit,
                                   offset=offset)
        return PatternScreen(date=out["date"], total=out["total"], items=[PatternItem(**it) for it in out["items"]])

    @strawberry.field(description="종목의 차트 패턴(베이스) 전부와 현재 베이스의 매수·손절 구간(숨김이면 null)")
    def pattern_bases(self, info: strawberry.Info, ticker: str) -> PatternBases:
        if not _market_ok(info):
            return PatternBases(date=None, ticker=ticker, name=ticker, close=None, bases=[], zones=None)
        out = pattern_query.bases(ticker)
        return PatternBases(
            date=out["date"], ticker=out["ticker"], name=out["name"], close=out["close"],
            bases=[PatternBase(**{**b, "points": [PatternPoint(**p) for p in b["points"]]}) for b in out["bases"]],
            zones=PatternZones(**out["zones"]) if out["zones"] else None,
        )

    # ------------------------------------------------------------ 시장 탭 (공개)
    @strawberry.field(description="시장 요약 — 국내·미국 지수(20일 스파크라인)·미국 거시 지표. "
                                  "시세 비노출이면 지수(KIS·장중 값)는 빈 목록, FRED 거시만 — 국내 지수 공개 스위치가 켜지면 코스피·코스닥만")
    async def market_overview(self, info: strawberry.Info) -> MarketOverview:
        # 동기 함수(CH·Redis 접속, Redis 무응답 시 최대 3초)를 스레드풀에서 — 이벤트 루프를 막지 않는다
        if not _market_ok(info):
            # 필드 단위 차단(설계 2-4) — FRED 거시만. 국내 지수 공개 스위치(MARKET_INDEX_KR)가 켜져 있으면
            # 코스피·코스닥(장중 값 포함)만 더한다. 미국 지수·원/달러(KIS)는 계속 비운다.
            macro = [MacroValue(**m) for m in await run_in_threadpool(market_query.macro)]
            indices: list[MarketIndex] = []
            if await run_in_threadpool(market_access.context_kr_index_allowed, info.context):
                indices = [MarketIndex(**i) for i in await run_in_threadpool(market_query.kr_indices)]
            return MarketOverview(indices=indices, macro=macro)
        out = await run_in_threadpool(market_query.overview)
        return MarketOverview(indices=[MarketIndex(**i) for i in out["indices"]],
                              macro=[MacroValue(**m) for m in out["macro"]])

    @strawberry.field(description="테마·업종 순위 — kind: theme|sector, period: 1d|5d|20d, sort: chg|value")
    def market_groups(self, info: strawberry.Info, kind: str = "theme", period: str = "1d", sort: str = "chg", limit: int = 30,
                      offset: int = 0) -> GroupRanking:
        if not _market_ok(info):
            return GroupRanking(date=None, total=0, items=[])
        out = market_query.groups(kind=kind, period=period, sort=sort, limit=limit, offset=offset)
        items = [GroupItem(**{**it, "leader": GroupLeader(**it["leader"]) if it["leader"] else None})
                 for it in out["items"]]
        return GroupRanking(date=out["date"], total=out["total"], items=items)

    @strawberry.field(description="트리맵 — 업종(전체)·테마(거래대금 상위 30), 면적 size: mcap|value")
    def market_treemap(self, info: strawberry.Info, kind: str = "sector", size: str = "mcap",
                       period: str = "1d") -> Treemap:
        if not _market_ok(info):
            return Treemap(date=None, groups=[])
        out = market_query.treemap(kind=kind, size=size, period=period)
        groups = [TreemapGroup(**{**g, "stocks": [TreemapStock(**s) for s in g["stocks"]]}) for g in out["groups"]]
        return Treemap(date=out["date"], groups=groups)

    @strawberry.field(description="테마·업종 상세 — 60거래일 순위 추이·구성 종목(없으면 null)")
    def market_group(self, info: strawberry.Info, kind: str, id: str) -> GroupDetail | None:  # noqa: A002
        if not _market_ok(info):
            return None
        out = market_query.group(kind, id)
        if out is None:
            return None
        return GroupDetail(**{**out, "history": [GroupHistory(**h) for h in out["history"]],
                              "stocks": [GroupStock(**s) for s in out["stocks"]]})

    @strawberry.field(description="스크리너 탭 보이기 스위치(종목 찾기 전체·조건검색·차트 패턴)와 요청자 기준 시세 열람 가능 여부 "
                                  "— 행이 없거나 조회 실패면 꺼짐")
    async def screener_features(self, info: strawberry.Info) -> ScreenerFeatures:
        m = await run_in_threadpool(screener_features.enabled_map)
        return ScreenerFeatures(stock_finder=m["STOCK_FINDER"], finder=m["FINDER"], patterns=m["PATTERNS"],
                                market_data=_market_ok(info),
                                market_index_kr=await run_in_threadpool(market_access.context_kr_index_allowed,
                                                                        info.context))

    @strawberry.field(description="일정 — 공모주·경제지표(최대 92일). 시세 비노출이면 공모주(KIS 예탁원 출처) 제외")
    def market_calendar(self, info: strawberry.Info, start: str, end: str,
                        category: str | None = None) -> list[CalendarEvent]:
        events = market_query.calendar(start, end, category)
        if not _market_ok(info):
            events = [e for e in events if e["category"] != market_query.IPO_CATEGORY]
        return [CalendarEvent(**e) for e in events]


schema = strawberry.Schema(query=Query)

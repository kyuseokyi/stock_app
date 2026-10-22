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


@strawberry.input(description="조건검색 필터 — 모두 선택. 금액은 억 원, 비율은 %(거래량 비율은 배)")
class ScreenerFilterInput:
    market: str | None = None  # ALL | KOSPI | KOSDAQ
    price_min: float | None = None
    price_max: float | None = None
    mcap_min: float | None = None
    mcap_max: float | None = None
    value_min: float | None = None
    liquid_only: bool = True  # 20일 평균 거래대금 10억·종가 1,000원 이상만
    vol_ratio_min: float | None = None
    rsi_min: float | None = None
    rsi_max: float | None = None
    ma_order: str | None = None  # PERFECT | REVERSE
    bb_sigma: float | None = None  # 1 · 1.5 · 2 · 2.5 · 3 (그 밖은 2)
    bb_position: str | None = None  # ABOVE | BELOW | INSIDE
    bb_width_max: float | None = None
    vp_above_max: float | None = None
    roe_min: float | None = None
    per_min: float | None = None
    per_max: float | None = None
    pbr_min: float | None = None
    pbr_max: float | None = None
    debt_ratio_max: float | None = None
    sales_growth_min: float | None = None


@strawberry.type
class ScreenerItem:
    ticker: str
    name: str
    market: str
    sector_name: str | None
    close: float
    chg_1d: float | None
    value: float  # 거래대금(원, 종가×거래량 근사)
    mcap: float | None  # 시가총액(원)
    vol_ratio20: float | None  # 당일 거래량 / 직전 20일 평균
    rsi14: float | None
    ma_order: int  # 1 정배열 · -1 역배열 · 0 혼합
    is_new_high: bool
    gc_days: int | None  # 골든크로스(20/60) 뒤 지난 거래일 0~2
    vp_above_pct: float | None  # 현재가 위 매물 비율(%)
    per: float | None
    pbr: float | None
    roe: float | None
    bb_position: str | None  # 요청 σ 기준 ABOVE | BELOW | INSIDE
    bb_width_pct: float | None


@strawberry.type
class ScreenerScreen:
    date: str | None  # 계산된 날이 없으면 null(준비 중)
    total: int
    bb_sigma: float  # 볼린저 위치·폭에 쓴 σ
    items: list[ScreenerItem]


# ---------------------------------------------------------------- 차트 패턴
@strawberry.type
class PatternItem:
    ticker: str
    name: str
    market: str
    sector_name: str | None
    close: float
    pattern_type: str  # cup | cup_with_handle | double_bottom | flat_base | consolidation | htf
    label: str
    stage: int  # 베이스 단계(base_count)
    pivot: float
    pivot_dist_pct: float | None  # (종가/피벗 - 1) × 100
    depth: float
    length: int
    is_active: bool  # 돌파 전
    breakout_date: str | None
    breakout_price_pct: float | None
    breakout_vol_pct: float | None
    days_since_breakout: int | None


@strawberry.type
class PatternScreen:
    date: str | None  # 계산된 날이 없으면 null(준비 중)
    total: int
    items: list[PatternItem]


@strawberry.type
class PatternPoint:
    role: str
    date: str | None
    price: float | None


@strawberry.type
class PatternBase:
    pattern_type: str
    label: str
    stage: int
    subcount: int
    totalcount: int
    rim_date: str | None
    low_date: str | None
    low_price: float | None
    pivot: float
    depth: float
    length: int
    is_active: bool
    is_current: bool
    breakout_date: str | None
    breakout_price_pct: float | None
    breakout_vol_pct: float | None
    days_since_breakout: int | None
    prior_uptrend_pct: float | None
    confidence: float
    points: list[PatternPoint]


@strawberry.type
class PatternZones:
    buy_low: float
    buy_high: float
    stop_low: float
    stop_high: float


@strawberry.type
class PatternBases:
    date: str | None
    ticker: str
    name: str
    close: float | None
    bases: list[PatternBase]
    zones: PatternZones | None  # 현재 베이스가 없거나 돌파 후 크게 벗어났으면 null


# ---------------------------------------------------------------- 시장 탭(지수·테마·업종·일정)
@strawberry.type
class MarketIndex:
    code: str
    name: str
    region: str  # KR | US | FX
    date: str
    close: float
    chg1d: float | None
    spark: list[float]
    live: bool = False  # 장중 값이 덧씌워졌는가(국내 지수·원/달러, 거래일 09:00~15:35 KST)
    as_of: str | None = None  # 장중 값 시각(KST 'HH:MM') — live 일 때만


@strawberry.type
class MacroValue:
    series_id: str
    name: str
    unit: str
    date: str
    value: float
    prev: float | None


@strawberry.type
class MarketOverview:
    indices: list[MarketIndex]
    macro: list[MacroValue]


@strawberry.type
class GroupLeader:
    ticker: str
    name: str
    chg: float | None


@strawberry.type
class GroupItem:
    id: str
    name: str
    members: int
    chg: float | None  # 선택 기간 평균 등락률(%)
    value: float
    up: int
    down: int
    flat: int
    leader: GroupLeader | None
    rank: int  # 1일 순위(0 = 순위 제외)
    streak: int  # 연속 상위(10위 안) 거래일 수


@strawberry.type
class GroupRanking:
    date: str | None
    total: int
    items: list[GroupItem]


@strawberry.type
class TreemapStock:
    ticker: str  # '' = 기타 묶음
    name: str
    chg: float | None
    size: float


@strawberry.type
class TreemapGroup:
    id: str
    name: str
    chg: float | None
    size: float
    stocks: list[TreemapStock]


@strawberry.type
class Treemap:
    date: str | None
    groups: list[TreemapGroup]


@strawberry.type
class GroupHistory:
    date: str
    chg1d: float | None
    rank: int


@strawberry.type
class GroupStock:
    ticker: str
    name: str
    close: float
    chg1d: float | None
    chg5d: float | None
    value: float
    mcap: float | None
    is_leader: bool
    reason: str | None


@strawberry.type
class GroupDetail:
    kind: str
    id: str
    name: str
    description: str | None
    date: str
    chg1d: float | None
    chg5d: float | None
    chg20d: float | None
    value: float
    mcap: float
    up: int
    down: int
    flat: int
    rank: int
    history: list[GroupHistory]
    stocks: list[GroupStock]


@strawberry.type
class CalendarEvent:
    date: str
    title: str
    category: str
    ticker: str | None
    name: str | None
    detail: str

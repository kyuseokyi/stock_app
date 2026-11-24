"""교육용 합성 종가 게임 DTO (/api/game/edu/*, /api/game/admin/edu/*).

가격은 호가 단위 정수(원), 금액은 소수 2자리 float, 수익률·등락률은 % float.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

ActionType = Literal["ENTER_LONG", "ENTER_SHORT", "HOLD_WATCH", "KEEP_POS", "PARTIAL_CLOSE", "FULL_CLOSE"]
RegimeName = Literal["ACCUMULATION", "UPTREND", "DISTRIBUTION", "DOWNTREND"]


class EduSeasonDTO(BaseModel):
    id: int
    season_number: int
    synthetic_code: str
    display_name: str          # hide_name 이면 '블라인드 교육 차트 #N', 아니면 title
    title: str | None          # hide_name 이면 None(화면에 이름을 숨김)
    theme_category: str | None
    hide_name: bool
    current_day_index: int
    status: str
    start_date: date
    initial_cash: float


class EduCandleDTO(BaseModel):
    day_index: int
    date: date
    open: int
    high: int
    low: int
    close: int
    volume: int
    change_pct: float
    pattern_tag: str | None


class EduTodayDTO(BaseModel):
    """오늘(마지막 공개 봉)의 해설·기준선."""

    day_index: int
    date: date
    close: int
    change_pct: float
    pattern_tag: str | None
    coach_comment: str | None
    support_price: int | None
    resistance_price: int | None
    poc_price: int | None


class EduCrowdDTO(BaseModel):
    """오늘(day_index) 참가자 선택 비율 — 제출 직후 보유 방향 기준."""

    total: int
    long: int
    short: int
    watch: int
    long_pct: float
    short_pct: float
    watch_pct: float


class EduPositionDTO(BaseModel):
    side: Literal["LONG", "SHORT"]
    entry_price: int
    size_amount: float
    leverage: int
    stop_loss_price: int | None
    take_profit_price: int | None
    opened_day_index: int | None
    unrealized_pnl: float
    roi_pct: float             # 진입 금액 대비 평가 손익률


class EduAccountDTO(BaseModel):
    cash_balance: float
    bonus_cash: float
    total_asset: float
    current_roi: float
    max_roi: float
    total_trades: int
    win_trades: int
    participation_days: int
    last_action_day_index: int | None
    position: EduPositionDTO | None


class EduActionDTO(BaseModel):
    day_index: int
    action_date: date
    action_type: str
    side: str | None
    ratio: float | None
    leverage: int
    stop_loss_price: int | None
    take_profit_price: int | None
    execution_price: int
    realized_pnl: float | None
    settlement_note: str | None


class EduOptionsDTO(BaseModel):
    ratios: list[float]
    leverages: list[int]
    stop_loss_pcts: list[int]
    take_profit_pcts: list[int]
    leverage_5x_unlocked: bool
    hold_watch_bonus: int


class EduFeaturesResponse(BaseModel):
    """GET /api/game/edu/features — 게임 탭 노출 판단용 전역 플래그만(사용자 무관, 시즌 생성 없음). 조회 실패는 false."""

    enabled: bool  # EDU_DAILY_GAME
    real_market_switch: bool  # REAL_MARKET 관리자 전역 스위치


class EduStateResponse(BaseModel):
    """enabled=false 면 나머지 필드는 기본값(null/빈 배열) — 프론트는 게임 화면을 숨긴다."""

    enabled: bool
    # 관리자 전역 스위치 REAL_MARKET 값(사용자별 열람 판정 아님) — 화면 분기용: true=실시간 게임만, false=가상 데이터 게임만.
    # enabled=false 최소 응답에도 들어간다. 조회 실패는 false(닫힘).
    real_market_switch: bool = False
    season: EduSeasonDTO | None = None
    candles: list[EduCandleDTO] = []
    today: EduTodayDTO | None = None
    crowd: EduCrowdDTO | None = None
    next_settlement_at: datetime | None = None
    logged_in: bool = False
    today_submitted: bool = False
    today_action: EduActionDTO | None = None
    account: EduAccountDTO | None = None
    options: EduOptionsDTO | None = None
    disclaimer: str | None = None


class EduActionRequest(BaseModel):
    action: ActionType
    # 진입(ENTER_*) 필수, KEEP_POS 는 손절·익절 재설정 시에만(진입가 기준 %)
    ratio: Literal[0.25, 0.5, 1.0] | None = None
    leverage: Literal[1, 2, 5] = 1
    stop_loss_pct: Literal[3, 5, 7] | None = None
    take_profit_pct: Literal[5, 10, 15] | None = None
    # 화면에 보던 봉 번호(state.season.current_day_index). 보내면 그 사이 새 봉이 열렸을 때 409 STALE_DAY.
    # 생략(옛 클라이언트)하면 지금 봉 종가로 그대로 처리한다.
    day_index: int | None = None


class EduActionResponse(BaseModel):
    action: EduActionDTO
    account: EduAccountDTO
    bonus_cash_awarded: float
    streak: int | None         # 연속 출석 일수(STREAK 꺼져 있으면 null)
    message: str


class EduHistoryResponse(BaseModel):
    season_id: int
    actions: list[EduActionDTO]


class EduLeaderRow(BaseModel):
    rank: int
    nickname: str | None
    current_roi: float
    total_asset: float
    participation_days: int
    win_trades: int
    total_trades: int


class EduLeaderboardResponse(BaseModel):
    season_id: int
    top: list[EduLeaderRow]
    my_rank: EduLeaderRow | None


# ---------------------------------------------------------------- 관리자
class EduAdminSeasonDTO(BaseModel):
    id: int
    season_number: int
    synthetic_code: str
    title: str
    theme_category: str
    hide_name: bool
    current_day_index: int
    current_regime: str
    regime_days_left: int
    next_regime_override: str | None
    status: str
    start_date: date
    last_advanced_date: date | None
    participants: int


class EduNewSeasonRequest(BaseModel):
    title: str = Field(default="[교육 지수] AI·반도체 모멘텀 가상그룹", min_length=1, max_length=100)
    theme_category: str = Field(default="IT/반도체", min_length=1, max_length=50)
    hide_name: bool = False
    start_price: Literal[50000, 100000] = 50000


class EduRegimeRequest(BaseModel):
    regime: RegimeName | None   # null = 지정 해제(자동 전이)


class EduAdvanceResponse(BaseModel):
    status: str                 # advanced | skipped | no_season
    season_id: int | None = None
    day_index: int | None = None
    close: int | None = None
    regime: str | None = None
    settled: int = 0            # 평가한 보유 포지션 수
    closed: int = 0             # 그중 손절·익절·강제청산된 수

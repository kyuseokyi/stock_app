"""트레이딩 게임 REST/WS DTO."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


# 주문 비중 선택지 — 칩(25/50/100%) + 드롭다운(10~90%). 그 외 값은 422.
OrderRatio = Literal[0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0]


class OrderRequest(BaseModel):
    season_id: int
    side: Literal["LONG", "SHORT"]
    ratio: OrderRatio
    leverage: Literal[1, 2, 5]
    # 진입가 대비 '주가' 변동 분수(0.05=5%) — 레버리지 반영 수익률 아님(pricing.tp_sl_prices)
    stop_loss_pct: float | None = Field(default=None, gt=0, le=1)
    take_profit_pct: float | None = Field(default=None, gt=0, le=1)


class PositionResponse(BaseModel):
    id: str
    side: str
    entry_price: Decimal
    size_amount: Decimal
    leverage: int
    stop_loss_price: Decimal | None
    take_profit_price: Decimal | None
    status: str
    roi_pct: Decimal | None = None
    pnl_amount: Decimal | None = None


class NudgeDTO(BaseModel):
    type: str      # WARNING | PRAISE | ADVICE
    code: str
    message: str


class OrderResultResponse(PositionResponse):
    """진입/수동청산 응답 — PositionResponse + 교육 넛지(Phase 5a). /positions/active 는 미사용."""
    nudges: list[NudgeDTO] = Field(default_factory=list)


class AccountResponse(BaseModel):
    season_id: int
    cash_balance: Decimal
    total_asset: Decimal
    current_roi: Decimal
    total_trades: int
    win_trades: int


# ---------------------------------------------------------------- Phase 5a: coach
CoachType = Literal["MORNING", "EVENING"]  # 모델의 IN_PLAY 는 5a 범위 밖


class CoachUpsertRequest(BaseModel):
    season_id: int
    target_date: date
    coach_type: CoachType
    title: str = Field(min_length=1, max_length=100)
    summary_nudge: str = Field(min_length=1, max_length=200)
    support_price: Decimal | None = Field(default=None, gt=0)
    resistance_price: Decimal | None = Field(default=None, gt=0)
    content_md: str = Field(min_length=1)
    action: Literal["draft", "publish"]

    @model_validator(mode="after")
    def _support_below_resistance(self) -> "CoachUpsertRequest":
        if (
            self.support_price is not None
            and self.resistance_price is not None
            and self.support_price >= self.resistance_price
        ):
            raise ValueError("지지선은 저항선보다 낮아야 합니다.")
        return self


class CoachMessageResponse(BaseModel):
    id: int
    season_id: int
    target_date: date
    coach_type: str
    title: str
    summary_nudge: str
    content_md: str
    support_price: Decimal | None
    resistance_price: Decimal | None
    status: str
    published_at: datetime | None


class CoachTodayResponse(BaseModel):
    target_date: date
    season_id: int | None
    morning: CoachMessageResponse | None
    evening: CoachMessageResponse | None
    active: CoachMessageResponse | None


class SeasonOption(BaseModel):
    id: int
    season_number: int
    ticker: str
    stock_name: str
    status: str
    start_at: datetime
    end_at: datetime | None


# ---------------------------------------------------------------- Phase 5b
class FeatureFlagResponse(BaseModel):
    key: str
    enabled: bool
    updated_at: datetime | None


class FeatureFlagUpdate(BaseModel):
    enabled: bool


class StreakRewardDTO(BaseModel):
    """연속 출석 마일스톤 보상(백로그 ⑤-1). amount 는 코드 상수 정수(원)."""

    milestone: int
    amount: int
    claimed: bool
    claimable: bool


class StreakResponse(BaseModel):
    current_streak: int
    highest_streak: int
    last_activity_date: date | None
    enabled: bool
    # 플래그 꺼짐·활성 시즌 없음이면 빈 배열
    rewards: list[StreakRewardDTO] = Field(default_factory=list)


class StreakRewardClaimResponse(BaseModel):
    streak: StreakResponse
    cash_balance: Decimal  # 지급 후 잔고


class QuestResponse(BaseModel):
    code: str
    title: str
    description: str
    target: int
    progress: int
    reward_cash: Decimal | None
    reward_badge: str | None
    completed: bool
    claimed: bool


class BadgeDTO(BaseModel):
    code: str
    name: str
    awarded_at: datetime | None


class QuestListResponse(BaseModel):
    quests: list[QuestResponse]
    badges: list[BadgeDTO]


class QuestClaimResponse(BaseModel):
    quest: QuestResponse
    cash_balance: Decimal | None  # 현금 보상일 때 지급 후 잔고
    badge: BadgeDTO | None


class AcademyQuestionDTO(BaseModel):
    id: int
    question: str
    choices: list[str]


class AcademyQuizResponse(BaseModel):
    unlocked: bool
    questions: list[AcademyQuestionDTO]


class AcademySubmitRequest(BaseModel):
    answers: dict[int, int]  # 문항 id → 선택 인덱스(0-based)


class AcademyResultItem(BaseModel):
    id: int
    correct: bool
    answer: int
    explanation: str


class AcademySubmitResponse(BaseModel):
    unlocked: bool
    results: list[AcademyResultItem]


class QuizQuestionResponse(BaseModel):
    """출제 — 정답 검색 방지를 위해 종목·날짜 은닉, 가격은 첫 종가=100 정규화."""
    id: int
    chart_snapshot: list[dict]
    time_limit_sec: int


class QuizSubmitRequest(BaseModel):
    choice: Literal["UP", "DOWN"]


class QuizSubmitResponse(BaseModel):
    correct: bool
    answer: str
    actual_change: Decimal
    pattern_type: str
    explanation: str
    rewarded: bool
    reward_cash: int
    timed_out: bool
    ticker: str  # 제출 후 공개
    base_date: date
    streak: StreakResponse | None

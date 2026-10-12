"""트레이딩 게임 REST/WS DTO."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class OrderRequest(BaseModel):
    season_id: int
    side: Literal["LONG", "SHORT"]
    ratio: Literal[0.25, 0.5, 1.0]
    leverage: Literal[1, 2, 5]
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


class StreakResponse(BaseModel):
    current_streak: int
    highest_streak: int
    last_activity_date: date | None
    enabled: bool

"""트레이딩 게임 REST/WS DTO."""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


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


class AccountResponse(BaseModel):
    season_id: int
    cash_balance: Decimal
    total_asset: Decimal
    current_roi: Decimal
    total_trades: int
    win_trades: int

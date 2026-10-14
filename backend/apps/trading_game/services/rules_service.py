"""게임 규칙 — 규칙 화면용 값을 실제 계산 상수에서 조립(문구에 숫자 하드코딩 금지).

모듈 속성으로 매 호출 시 읽는다(설정·monkeypatch 반영).
"""
from __future__ import annotations

from decimal import Decimal
from typing import get_args

from sqlalchemy.ext.asyncio import AsyncSession

from shared import game_models
from apps.trading_game.schemas.game_dtos import OrderRequest
from apps.trading_game.services import (
    academy_service, connection_manager, game_settings_service, market_clock, order_engine, pricing,
)


def _num(v) -> int | float:
    """Decimal/float → 정수면 int, 아니면 float(JSON 표기용)."""
    d = Decimal(str(v))
    return int(d) if d == d.to_integral_value() else float(d)


def allowed_leverages() -> list[int]:
    """주문 스키마(OrderRequest.leverage Literal)의 실제 허용 배율."""
    return sorted(get_args(OrderRequest.model_fields["leverage"].annotation))


async def build_rules(db: AsyncSession) -> dict:
    return {
        "initial_cash": _num(game_models.INITIAL_CASH),
        "min_order_amount": _num(order_engine.MIN_ORDER_AMOUNT),
        "max_open_positions": order_engine.MAX_OPEN_POSITIONS,
        "trading_windows": [
            [s.strftime("%H:%M"), e.strftime("%H:%M")] for s, e in market_clock.load_windows()
        ],
        "leverages": allowed_leverages(),
        "leverage_unlock": {str(academy_service.ACADEMY_LEVERAGE): "academy"},
        "fee_roundtrip_pct": float(pricing.FEE_ROUNDTRIP_PCT),
        "margin_call_roi_pct": _num(pricing.MARGIN_CALL_ROI_PCT),
        "sentiment_interval_sec": _num(connection_manager.SENTIMENT_INTERVAL),
        "rewards": await game_settings_service.reward_config(db),
        "chart_interval_default": await game_settings_service.chart_interval_default(db),
        "chart_intervals": list(game_settings_service.CHART_INTERVALS),
    }

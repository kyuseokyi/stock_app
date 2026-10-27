"""스마트 넛지 규칙 엔진 — I/O 없는 순수 함수 (Phase 5a).

주문 진입/청산 직후 사용자에게 보여 줄 교육용 말풍선을 결정한다.
판정 기준값은 스펙 §3.1 참조. roi_pct 는 GameTrade.roi_pct(레버리지·왕복수수료 반영 %, 화면 표시 ROI).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

NudgeType = Literal["WARNING", "PRAISE", "ADVICE"]

RSI_OVERBOUGHT = 80.0
PRAISE_ROI_MIN = Decimal("-3")
PRAISE_ROI_MAX = Decimal("-1")
_PRAISE_REASONS = frozenset({"STOP_LOSS", "MANUAL", "MANUAL_SL", "MANUAL_TP"})  # MANUAL = 2026-10 이전 기록


@dataclass(frozen=True)
class Nudge:
    type: NudgeType
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"type": self.type, "code": self.code, "message": self.message}


OVERBOUGHT_CHASE = Nudge(
    "WARNING", "OVERBOUGHT_CHASE", "⚠️ RSI 과열 구간입니다! 추격 매수는 물릴 위험이 높아요."
)
OVERLEVERAGE = Nudge(
    "ADVICE", "OVERLEVERAGE",
    "💬 과도한 레버리지는 급격한 마진콜을 유발할 수 있습니다. 분할 매수를 고려하세요.",
)
PRINCIPLED_STOP = Nudge(
    "PRAISE", "PRINCIPLED_STOP", "💡 원칙대로 손실을 잘 끊어냈습니다! 훌륭한 자금 관리 습관입니다."
)


def nudges_for_open(*, side: str, ratio: float, leverage: int, rsi: float | None) -> list[Nudge]:
    """진입 넛지. 순서: WARNING → ADVICE (둘 다 해당 가능)."""
    out: list[Nudge] = []
    if side == "LONG" and rsi is not None and rsi >= RSI_OVERBOUGHT:
        out.append(OVERBOUGHT_CHASE)
    if Decimal(str(ratio)) == Decimal("1") and leverage == 5:
        out.append(OVERLEVERAGE)
    return out


def nudges_for_close(*, closed_reason: str, roi_pct: Decimal | None) -> list[Nudge]:
    """청산 넛지. 손절(STOP_LOSS) 또는 수동청산(MANUAL) 이 ROI -3% ~ -1% 일 때만 칭찬."""
    if roi_pct is None or closed_reason not in _PRAISE_REASONS:
        return []
    roi = Decimal(str(roi_pct))
    if PRAISE_ROI_MIN <= roi <= PRAISE_ROI_MAX:
        return [PRINCIPLED_STOP]
    return []

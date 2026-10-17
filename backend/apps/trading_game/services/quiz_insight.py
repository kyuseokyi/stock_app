"""차트 퀴즈 결과 한 줄 — 패턴이 흔히 기대하는 방향과 실제 결과를 이어 준다(B2).

패턴 라벨은 scripts.generate_chart_quiz.SIGNALS·build_explanation 이 만든 값. 관리자가 라벨을 고쳐
여기 없는 값이 되면 결과 줄은 생략(None)한다.
"""
from __future__ import annotations

from decimal import Decimal

# 흔한 해석의 기대 방향. None = 방향 신호 아님(거래량 급증)
PATTERN_DIRECTION: dict[str, str | None] = {
    "골든크로스": "UP",
    "20일 신고가": "UP",
    "RSI 과매도": "UP",
    "정배열": "UP",
    "데드크로스": "DOWN",
    "20일 신저가": "DOWN",
    "RSI 과매수": "DOWN",
    "역배열": "DOWN",
    "거래량 급증": None,
}


def outcome_text(pattern_type: str, answer: str, actual_change: Decimal | float) -> str | None:
    if pattern_type not in PATTERN_DIRECTION:
        return None
    change = float(actual_change)
    moved = f"{change:+.1f}% {'올랐' if answer == 'UP' else '내렸'}어요"
    expected = PATTERN_DIRECTION[pattern_type]
    if expected is None:
        return f"📊 {pattern_type} 뒤 5거래일 동안 {moved} — 거래량 신호는 방향보다 '관심이 몰렸다'는 뜻이에요"
    if expected == answer:
        return f"{'📈' if answer == 'UP' else '📉'} {pattern_type} 신호대로 {moved}"
    return f"🔄 {pattern_type} 신호와 반대로 {moved} — 신호는 확률일 뿐이에요"

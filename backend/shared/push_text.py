"""푸시 문구 치환 — blog(미리보기)·collector(발송 직전) 공용."""
from __future__ import annotations

from datetime import date


def render_push_text(text: str, ref_date: date) -> str:
    """`{date}` 를 `M월 D일` 로 바꾼다(예: 3월 5일)."""
    return text.replace("{date}", f"{ref_date.month}월 {ref_date.day}일")

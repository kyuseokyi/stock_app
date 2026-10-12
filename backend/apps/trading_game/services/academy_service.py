"""아카데미 — 리스크 관리 미니 퀴즈(3문항) 통과 시 5배 레버리지 해금 (Phase 5b).

문항은 코드 고정(정답 인덱스 0-based). 재응시 무제한.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import UserAcademy


@dataclass(frozen=True)
class AcademyQuestion:
    id: int
    question: str
    choices: tuple[str, ...]
    answer: int
    explanation: str


QUESTIONS: tuple[AcademyQuestion, ...] = (
    AcademyQuestion(
        1, "5배 레버리지로 LONG 진입한 뒤 주가가 16% 하락하면 어떻게 될까요?",
        ("16% 손실", "32% 손실", "증거금 80% 손실로 강제 청산(마진콜)", "손실 없음"), 2,
        "레버리지 5배에서는 주가 -16%가 증거금 -80%에 해당해 마진콜로 강제 청산됩니다.",
    ),
    AcademyQuestion(
        2, "손절선(Stop-Loss)을 미리 정해 두는 가장 큰 이유는?",
        ("수익을 키우기 위해", "감정에 휘둘리지 않고 손실을 제한하기 위해", "수수료를 줄이기 위해", "거래 횟수를 늘리기 위해"), 1,
        "손절선은 '얼마까지 잃을지'를 진입 전에 정해 감정적인 버티기를 막아 줍니다.",
    ),
    AcademyQuestion(
        3, "자금 관리 원칙으로 가장 적절한 것은?",
        ("한 번에 전 재산을 건다", "손실을 만회하려고 비중을 늘린다", "한 번의 거래에는 자본의 일부만 쓴다", "항상 최대 레버리지를 쓴다"), 2,
        "한 번의 실수로 게임이 끝나지 않도록 거래당 비중을 작게 유지하는 것이 기본입니다.",
    ),
)


async def is_unlocked(db: AsyncSession, user_id: int) -> bool:
    row = await db.get(UserAcademy, user_id)
    return bool(row and row.unlocked_leverage_5x)


async def submit(
    db: AsyncSession, user_id: int, answers: dict[int, int], *, now: datetime | None = None
) -> tuple[list[dict], bool]:
    """채점 → (문항별 결과, 해금 여부). 미응답 문항은 오답. commit 포함."""
    results = [
        {"id": q.id, "correct": answers.get(q.id) == q.answer, "answer": q.answer, "explanation": q.explanation}
        for q in QUESTIONS
    ]
    passed = all(r["correct"] for r in results)
    row = await db.get(UserAcademy, user_id)
    if row is None:
        row = UserAcademy(user_id=user_id, unlocked_leverage_5x=False, attempts=0)
        db.add(row)
    row.attempts += 1
    if passed and not row.unlocked_leverage_5x:
        row.unlocked_leverage_5x = True
        row.passed_at = now or datetime.now(timezone.utc)
    await db.commit()
    return results, row.unlocked_leverage_5x

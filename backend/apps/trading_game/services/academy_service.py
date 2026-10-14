"""아카데미 — 리스크 관리 미니 퀴즈 통과 시 5배 레버리지 해금 (Phase 5b).

문항은 DB(`academy_questions`, 관리자 편집 — 백로그 ⑤-2). **활성 문항 전부 정답**이어야 해금.
활성 문항이 0개면 제출 불가(NO_QUESTIONS). 이미 해금한 사용자는 문항이 바뀌어도 해금 유지.
재응시 무제한. 정답 인덱스는 0-based.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import AcademyQuestion, UserAcademy

ACADEMY_LEVERAGE = 5  # 아카데미 통과 시 해금되는 배율(orders 게이트·규칙 API 공용)


class AcademyError(Exception):
    """code: NO_QUESTIONS | NOT_FOUND"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


_ORDER = (AcademyQuestion.sort_order, AcademyQuestion.id)


async def list_active(db: AsyncSession) -> list[AcademyQuestion]:
    rows = await db.execute(select(AcademyQuestion).where(AcademyQuestion.is_active.is_(True)).order_by(*_ORDER))
    return list(rows.scalars().all())


async def is_unlocked(db: AsyncSession, user_id: int) -> bool:
    row = await db.get(UserAcademy, user_id)
    return bool(row and row.unlocked_leverage_5x)


async def submit(
    db: AsyncSession, user_id: int, answers: dict[int, int], *, now: datetime | None = None
) -> tuple[list[dict], bool]:
    """채점 → (문항별 결과, 해금 여부). 미응답 문항은 오답. commit 포함."""
    questions = await list_active(db)
    if not questions:  # 빈 집합은 all([])=True 로 해금되므로 응시 기록 전에 차단
        raise AcademyError("NO_QUESTIONS", "지금은 아카데미 문항이 준비되지 않았습니다.")
    results = [
        {"id": q.id, "correct": answers.get(q.id) == q.answer, "answer": q.answer, "explanation": q.explanation}
        for q in questions
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


# ---------------------------------------------------------------- 관리자 CRUD
async def list_all(db: AsyncSession) -> list[AcademyQuestion]:
    return list((await db.execute(select(AcademyQuestion).order_by(*_ORDER))).scalars().all())


async def _get_or_404(db: AsyncSession, question_id: int) -> AcademyQuestion:
    row = await db.get(AcademyQuestion, question_id)
    if row is None:
        raise AcademyError("NOT_FOUND", "문항을 찾을 수 없습니다.")
    return row


async def create_question(db: AsyncSession, fields: dict) -> AcademyQuestion:
    row = AcademyQuestion(**fields)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_question(db: AsyncSession, question_id: int, fields: dict) -> AcademyQuestion:
    row = await _get_or_404(db, question_id)
    for key, value in fields.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row


async def delete_question(db: AsyncSession, question_id: int) -> None:
    row = await _get_or_404(db, question_id)
    await db.delete(row)
    await db.commit()

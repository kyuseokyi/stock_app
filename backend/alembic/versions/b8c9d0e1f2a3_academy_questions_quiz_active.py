"""admin quiz/academy editor: academy_questions (+seed 3) + chart_quiz_pool.is_active (backlog 5-2)

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None

# 기존 코드 상수(academy_service.QUESTIONS)와 동일한 초기 문항 — 서비스 import 금지(마이그레이션 고정)
_SEED = [
    {
        "id": 1,
        "question": "5배 레버리지로 LONG 진입한 뒤 주가가 16% 하락하면 어떻게 될까요?",
        "choices": ["16% 손실", "32% 손실", "증거금 80% 손실로 강제 청산(마진콜)", "손실 없음"],
        "answer": 2,
        "explanation": "레버리지 5배에서는 주가 -16%가 증거금 -80%에 해당해 마진콜로 강제 청산됩니다.",
        "sort_order": 1,
        "is_active": True,
    },
    {
        "id": 2,
        "question": "손절선(Stop-Loss)을 미리 정해 두는 가장 큰 이유는?",
        "choices": ["수익을 키우기 위해", "감정에 휘둘리지 않고 손실을 제한하기 위해", "수수료를 줄이기 위해", "거래 횟수를 늘리기 위해"],
        "answer": 1,
        "explanation": "손절선은 '얼마까지 잃을지'를 진입 전에 정해 감정적인 버티기를 막아 줍니다.",
        "sort_order": 2,
        "is_active": True,
    },
    {
        "id": 3,
        "question": "자금 관리 원칙으로 가장 적절한 것은?",
        "choices": ["한 번에 전 재산을 건다", "손실을 만회하려고 비중을 늘린다", "한 번의 거래에는 자본의 일부만 쓴다", "항상 최대 레버리지를 쓴다"],
        "answer": 2,
        "explanation": "한 번의 실수로 게임이 끝나지 않도록 거래당 비중을 작게 유지하는 것이 기본입니다.",
        "sort_order": 3,
        "is_active": True,
    },
]


def upgrade() -> None:
    questions = op.create_table(
        "academy_questions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("choices", sa.JSON, nullable=False),
        sa.Column("answer", sa.Integer, nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.bulk_insert(questions, _SEED)
    if op.get_bind().dialect.name == "postgresql":
        # 명시 id 로 넣었으므로 시퀀스를 맞춘다(안 하면 첫 관리자 생성이 id=1 중복으로 실패)
        op.execute(
            "SELECT setval(pg_get_serial_sequence('academy_questions', 'id'), "
            "(SELECT MAX(id) FROM academy_questions))"
        )
    op.add_column(
        "chart_quiz_pool",
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("chart_quiz_pool", "is_active")
    op.drop_table("academy_questions")

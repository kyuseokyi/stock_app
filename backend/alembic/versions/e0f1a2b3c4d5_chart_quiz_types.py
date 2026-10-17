"""차트 퀴즈 유형 — chart_quiz_pool.quiz_type/choices, answer·user_quiz_attempts.choice 길이 10→20

PATTERN 정답 코드(BREAKOUT_HIGH 13자)가 10자를 넘는다. VARCHAR 길이 확장은 PG 에서 메타데이터 변경뿐.
downgrade 는 10자 초과 값이 남아 있으면 실패하므로 4지선다 문제(·그 시도 기록)를 먼저 지운다.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-10-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e0f1a2b3c4d5"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chart_quiz_pool",
        sa.Column("quiz_type", sa.String(20), nullable=False, server_default="DIRECTION"),
    )
    op.add_column("chart_quiz_pool", sa.Column("choices", sa.JSON(), nullable=True))
    op.alter_column("chart_quiz_pool", "answer", type_=sa.String(20), existing_type=sa.String(10),
                    existing_nullable=False)
    op.alter_column("user_quiz_attempts", "choice", type_=sa.String(20), existing_type=sa.String(10),
                    existing_nullable=True)


def downgrade() -> None:
    op.execute(
        "DELETE FROM user_quiz_attempts WHERE quiz_id IN "
        "(SELECT id FROM chart_quiz_pool WHERE quiz_type <> 'DIRECTION')"
    )
    op.execute("DELETE FROM chart_quiz_pool WHERE quiz_type <> 'DIRECTION'")
    op.alter_column("user_quiz_attempts", "choice", type_=sa.String(10), existing_type=sa.String(20),
                    existing_nullable=True)
    op.alter_column("chart_quiz_pool", "answer", type_=sa.String(10), existing_type=sa.String(20),
                    existing_nullable=False)
    op.drop_column("chart_quiz_pool", "choices")
    op.drop_column("chart_quiz_pool", "quiz_type")

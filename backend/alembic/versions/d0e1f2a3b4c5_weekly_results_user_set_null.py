"""weekly_ranking_results.user_id → nullable + FK ON DELETE SET NULL (회원 탈퇴 익명화)

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-14

UNIQUE(season_id, week_start, user_id) 는 PG 에서 NULL 다중 허용이라 그대로 둔다.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None

TABLE = "weekly_ranking_results"
FK_NAME = "weekly_ranking_results_user_id_fkey"  # c9d0e1f2a3b4 가 이름 없이 만든 PG 기본 이름


def upgrade() -> None:
    op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    op.alter_column(TABLE, "user_id", existing_type=sa.Integer(), nullable=True)
    op.create_foreign_key(FK_NAME, TABLE, "users", ["user_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    # NOT NULL 복원 전 익명화(탈퇴) 행을 지운다 — 되돌리면 탈퇴 회원의 주간 기록은 사라진다.
    op.execute(sa.text(f"DELETE FROM {TABLE} WHERE user_id IS NULL"))
    op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")
    op.alter_column(TABLE, "user_id", existing_type=sa.Integer(), nullable=False)
    op.create_foreign_key(FK_NAME, TABLE, "users", ["user_id"], ["id"], ondelete="CASCADE")

"""차트 퀴즈 이후 봉 — chart_quiz_pool.future_snapshot(JSON, NULL 허용)

Revision ID: c8d9e0f1a2b3
Revises: e7f8a9b0c1d2
Create Date: 2026-10-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c8d9e0f1a2b3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chart_quiz_pool", sa.Column("future_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chart_quiz_pool", "future_snapshot")

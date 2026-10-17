"""차트 퀴즈 차트 길이·예측 기간 — chart_quiz_pool.window_bars / horizon_bars(기존 행 60·5)

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-10-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chart_quiz_pool", sa.Column("window_bars", sa.Integer(), nullable=False, server_default="60"))
    op.add_column("chart_quiz_pool", sa.Column("horizon_bars", sa.Integer(), nullable=False, server_default="5"))


def downgrade() -> None:
    op.drop_column("chart_quiz_pool", "horizon_bars")
    op.drop_column("chart_quiz_pool", "window_bars")

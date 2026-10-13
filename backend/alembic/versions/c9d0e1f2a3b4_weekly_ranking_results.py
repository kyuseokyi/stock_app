"""weekly ranking results (weekly leaderboard archive + rewards)

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "weekly_ranking_results",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "season_id", sa.Integer, sa.ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("week_start", sa.Date, nullable=False),
        sa.Column("rank", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nickname", sa.String(50), nullable=True),
        sa.Column("weekly_roi", sa.Numeric(10, 4), nullable=False),
        sa.Column("reward_amount", sa.Numeric(15, 2), nullable=False, server_default="0"),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("season_id", "week_start", "rank", name="uq_weekly_result_rank"),
        sa.UniqueConstraint("season_id", "week_start", "user_id", name="uq_weekly_result_user"),
    )


def downgrade() -> None:
    op.drop_table("weekly_ranking_results")

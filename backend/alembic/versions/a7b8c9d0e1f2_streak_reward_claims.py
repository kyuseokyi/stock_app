"""streak milestone rewards: streak_reward_claims (backlog 5-1)

Revision ID: a7b8c9d0e1f2
Revises: e5f6a7b8c9d0
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "streak_reward_claims",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "season_id", sa.Integer, sa.ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("milestone", sa.Integer, nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "user_id", "season_id", "milestone", name="uq_streak_reward_user_season_milestone"
        ),
    )


def downgrade() -> None:
    op.drop_table("streak_reward_claims")

"""Phase 5b: bonus_cash + quest/badge/academy/quiz/streak/feature-flag tables

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def _user_fk() -> sa.Column:
    return sa.Column(
        "user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


def upgrade() -> None:
    op.add_column(
        "game_accounts",
        sa.Column("bonus_cash", sa.Numeric(15, 2), nullable=False, server_default="0"),
    )
    op.create_table(
        "user_quest_progress",
        _user_fk(),
        sa.Column("quest_code", sa.String(30), primary_key=True),
        sa.Column("progress", sa.Integer, nullable=False, server_default="0"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "user_badges",
        _user_fk(),
        sa.Column("badge_code", sa.String(30), primary_key=True),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "user_academy",
        _user_fk(),
        sa.Column("unlocked_leverage_5x", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("passed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "chart_quiz_pool",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("base_date", sa.Date, nullable=False),
        sa.Column("pattern_type", sa.String(50), nullable=False),
        sa.Column("chart_snapshot", sa.JSON, nullable=False),
        sa.Column("answer", sa.String(10), nullable=False),
        sa.Column("actual_change", sa.Numeric(6, 2), nullable=False),
        sa.Column("explanation", sa.Text, nullable=False),
        sa.Column("reward_cash", sa.Integer, nullable=False, server_default="200000"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("ticker", "base_date", name="uq_quiz_ticker_base_date"),
    )
    op.create_table(
        "user_quiz_attempts",
        _user_fk(),
        sa.Column(
            "quiz_id", sa.Integer, sa.ForeignKey("chart_quiz_pool.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("served_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("choice", sa.String(10), nullable=True),
        sa.Column("is_correct", sa.Boolean, nullable=True),
        sa.Column("rewarded", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("reward_date", sa.Date, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "user_streaks",
        _user_fk(),
        sa.Column("current_streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("highest_streak", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_activity_date", sa.Date, nullable=True),
    )
    flags = op.create_table(
        "game_feature_flags",
        sa.Column("key", sa.String(30), primary_key=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.func.now()),
    )
    op.bulk_insert(flags, [{"key": "QUIZ", "enabled": True}, {"key": "STREAK", "enabled": True}])


def downgrade() -> None:
    op.drop_table("game_feature_flags")
    op.drop_table("user_streaks")
    op.drop_table("user_quiz_attempts")
    op.drop_table("chart_quiz_pool")
    op.drop_table("user_academy")
    op.drop_table("user_badges")
    op.drop_table("user_quest_progress")
    op.drop_column("game_accounts", "bonus_cash")

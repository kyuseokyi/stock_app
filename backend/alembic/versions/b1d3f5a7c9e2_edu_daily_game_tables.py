"""교육용 합성 종가 게임 테이블 4개 — edu_game_seasons·candles·accounts·daily_actions

명세: docs/edu_synthetic_daily_game_spec_and_plan.md 4.1
기존 실시간 게임 테이블(game_*)은 건드리지 않는다(추가만).
명세 외 추가: edu_game_daily_actions.side(참여자 심리 집계), ACTIVE 시즌 1개 부분 유일 인덱스.

Revision ID: b1d3f5a7c9e2
Revises: a7c9e1b3d5f8
Create Date: 2026-11-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b1d3f5a7c9e2"
down_revision = "a7c9e1b3d5f8"
branch_labels = None
depends_on = None


def _ts(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)


def upgrade() -> None:
    op.create_table(
        "edu_game_seasons",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("season_number", sa.Integer(), nullable=False),
        sa.Column("synthetic_code", sa.String(20), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("theme_category", sa.String(50), nullable=False),
        sa.Column("hide_name", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("seed_key", sa.String(64), nullable=False),
        sa.Column("current_day_index", sa.Integer(), server_default="120", nullable=False),
        sa.Column("current_regime", sa.String(30), server_default="ACCUMULATION", nullable=False),
        sa.Column("regime_days_left", sa.Integer(), server_default="8", nullable=False),
        sa.Column("next_regime_override", sa.String(30), nullable=True),
        sa.Column("initial_cash", sa.Numeric(15, 2), server_default="10000000", nullable=False),
        sa.Column("status", sa.String(20), server_default="ACTIVE", nullable=False),
        sa.Column("last_advanced_date", sa.Date(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_number", name="uq_edu_season_number"),
    )
    # 활성 교육 시즌은 동시에 1개 — 부트스트랩 동시 요청에서 두 번째 INSERT 가 실패하게
    op.create_index(
        "uq_edu_one_active_season", "edu_game_seasons", ["status"], unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    op.create_table(
        "edu_game_candles",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("display_date", sa.Date(), nullable=False),
        sa.Column("open", sa.Numeric(12, 2), nullable=False),
        sa.Column("high", sa.Numeric(12, 2), nullable=False),
        sa.Column("low", sa.Numeric(12, 2), nullable=False),
        sa.Column("close", sa.Numeric(12, 2), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("change_pct", sa.Numeric(8, 4), server_default="0", nullable=False),
        sa.Column("regime", sa.String(30), nullable=False),
        sa.Column("pattern_tag", sa.String(50), nullable=True),
        sa.Column("coach_comment", sa.Text(), nullable=True),
        sa.Column("support_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("resistance_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("poc_price", sa.Numeric(12, 2), nullable=True),
        _ts("created_at"),
        sa.ForeignKeyConstraint(["season_id"], ["edu_game_seasons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "day_index", name="uq_edu_season_day"),
    )
    op.create_index("idx_edu_candles_season_day", "edu_game_candles", ["season_id", "day_index"])

    op.create_table(
        "edu_game_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("cash_balance", sa.Numeric(15, 2), server_default="10000000", nullable=False),
        sa.Column("bonus_cash", sa.Numeric(15, 2), server_default="0", nullable=False),
        sa.Column("total_asset", sa.Numeric(15, 2), server_default="10000000", nullable=False),
        sa.Column("current_roi", sa.Numeric(8, 4), server_default="0", nullable=False),
        sa.Column("max_roi", sa.Numeric(8, 4), server_default="0", nullable=False),
        sa.Column("total_trades", sa.Integer(), server_default="0", nullable=False),
        sa.Column("win_trades", sa.Integer(), server_default="0", nullable=False),
        sa.Column("participation_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_action_day_index", sa.Integer(), nullable=True),
        sa.Column("last_action_date", sa.Date(), nullable=True),
        sa.Column("pos_side", sa.String(10), nullable=True),
        sa.Column("pos_entry_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("pos_size_amount", sa.Numeric(15, 2), nullable=True),
        sa.Column("pos_leverage", sa.Integer(), server_default="1", nullable=False),
        sa.Column("pos_stop_loss", sa.Numeric(12, 2), nullable=True),
        sa.Column("pos_take_profit", sa.Numeric(12, 2), nullable=True),
        sa.Column("pos_opened_day_index", sa.Integer(), nullable=True),
        _ts("created_at"),
        _ts("updated_at"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["season_id"], ["edu_game_seasons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "season_id", name="uq_edu_user_season"),
    )

    op.create_table(
        "edu_game_daily_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("action_date", sa.Date(), nullable=False),
        sa.Column("action_type", sa.String(20), nullable=False),
        sa.Column("side", sa.String(10), nullable=True),
        sa.Column("ratio", sa.Numeric(5, 4), nullable=True),
        sa.Column("leverage", sa.Integer(), server_default="1", nullable=False),
        sa.Column("stop_loss_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("take_profit_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("execution_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("realized_pnl", sa.Numeric(15, 2), nullable=True),
        sa.Column("settlement_note", sa.String(200), nullable=True),
        _ts("created_at"),
        sa.ForeignKeyConstraint(["account_id"], ["edu_game_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["season_id"], ["edu_game_seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "day_index", name="uq_edu_account_day_index"),
    )
    op.create_index("idx_edu_actions_season_day", "edu_game_daily_actions", ["season_id", "day_index"])


def downgrade() -> None:
    op.drop_index("idx_edu_actions_season_day", table_name="edu_game_daily_actions")
    op.drop_table("edu_game_daily_actions")
    op.drop_table("edu_game_accounts")
    op.drop_index("idx_edu_candles_season_day", table_name="edu_game_candles")
    op.drop_table("edu_game_candles")
    op.drop_index("uq_edu_one_active_season", table_name="edu_game_seasons")
    op.drop_table("edu_game_seasons")

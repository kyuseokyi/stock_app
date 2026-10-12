"""game phase3 trade fields + single-open partial unique index

Revision ID: a1b2c3d4e5f6
Revises: 662687b086a3
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "662687b086a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("game_positions", sa.Column("entry_ratio", sa.Numeric(5, 4), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("size_amount", sa.Numeric(15, 2), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("leverage", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("game_trades", sa.Column("entry_ratio", sa.Numeric(5, 4), nullable=False, server_default="0"))
    op.add_column("game_trades", sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.add_column("game_trades", sa.Column("had_stop_loss", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index(
        "uq_account_single_open",
        "game_positions",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )


def downgrade() -> None:
    op.drop_index("uq_account_single_open", table_name="game_positions")
    op.drop_column("game_trades", "had_stop_loss")
    op.drop_column("game_trades", "opened_at")
    op.drop_column("game_trades", "entry_ratio")
    op.drop_column("game_trades", "leverage")
    op.drop_column("game_trades", "size_amount")
    op.drop_column("game_positions", "entry_ratio")

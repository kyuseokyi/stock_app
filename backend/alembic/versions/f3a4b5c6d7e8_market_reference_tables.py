"""market reference tables: stock_profile, sectors, themes, theme_stocks, stock_events

Revision ID: f3a4b5c6d7e8
Revises: e0f1a2b3c4d5
Create Date: 2026-10-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stock_profile",
        sa.Column("ticker", sa.String(20), primary_key=True),
        sa.Column("market", sa.String(10), nullable=False),
        sa.Column("mcap_size", sa.String(1), nullable=False, server_default=""),
        sa.Column("sector_l", sa.String(4), nullable=False, server_default=""),
        sa.Column("sector_m", sa.String(4), nullable=False, server_default=""),
        sa.Column("sector_s", sa.String(4), nullable=False, server_default=""),
        sa.Column("is_etp", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_spac", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_preferred", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_halted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_managed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("warning_code", sa.String(2), nullable=False, server_default=""),
        sa.Column("listed_date", sa.Date(), nullable=True),
        sa.Column("listed_shares_k", sa.BigInteger(), nullable=True),
        sa.Column("market_cap_100m", sa.BigInteger(), nullable=True),
        sa.Column("settle_month", sa.SmallInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "sectors",
        sa.Column("code", sa.String(4), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
    )
    op.create_table(
        "themes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kis_code", sa.String(10), nullable=True, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("source", sa.String(10), nullable=False, server_default="kis"),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "theme_stocks",
        sa.Column("theme_id", sa.Integer(), sa.ForeignKey("themes.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ticker", sa.String(20), primary_key=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="kis"),
        sa.Column("is_excluded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_theme_stocks_ticker", "theme_stocks", ["ticker"])
    op.create_table(
        "stock_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("ticker", sa.String(20), nullable=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_key", sa.String(120), nullable=False, unique=True),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_stock_events_event_date", "stock_events", ["event_date"])


def downgrade() -> None:
    op.drop_index("ix_stock_events_event_date", table_name="stock_events")
    op.drop_table("stock_events")
    op.drop_index("ix_theme_stocks_ticker", table_name="theme_stocks")
    op.drop_table("theme_stocks")
    op.drop_table("themes")
    op.drop_table("sectors")
    op.drop_table("stock_profile")

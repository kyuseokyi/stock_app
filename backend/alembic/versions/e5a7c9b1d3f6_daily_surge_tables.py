"""급등락·테마 분석 — daily_surge_stocks·daily_surge_theme_groups·daily_surge_notes

설계: docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
- 새 표만 만든다(무중단 배포 중 옛 컨테이너와 함께 떠도 안전). 기존 표는 건드리지 않는다.
- 네이버 뉴스 결과는 저장하지 않는다(약관). 공시(DART)는 dart_items 에 저장한다.

Revision ID: e5a7c9b1d3f6
Revises: d4f6b8c0e2a4
Create Date: 2026-11-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e5a7c9b1d3f6"
down_revision = "d4f6b8c0e2a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    jsonb = postgresql.JSONB(astext_type=sa.Text())
    op.create_table(
        "daily_surge_stocks",
        sa.Column("trade_date", sa.Date(), primary_key=True),
        sa.Column("ticker", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("market", sa.String(10), nullable=False, server_default=""),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("prev_close", sa.Float(), nullable=False),
        sa.Column("change_price", sa.Float(), nullable=False),
        sa.Column("change_rate", sa.Float(), nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False),
        sa.Column("volume_ratio", sa.Float(), nullable=True),
        sa.Column("trading_value", sa.Float(), nullable=False),
        sa.Column("is_surge", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_plunge", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_top_value", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("surge_rank", sa.Integer(), nullable=True),
        sa.Column("plunge_rank", sa.Integer(), nullable=True),
        sa.Column("value_rank", sa.Integer(), nullable=True),
        sa.Column("primary_theme_id", sa.Integer(), nullable=True),
        sa.Column("primary_theme_name", sa.String(100), nullable=True),
        sa.Column("is_theme_leader", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("dart_items", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("dart_keywords", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_daily_surge_stocks_trade_date", "daily_surge_stocks", ["trade_date"])
    op.create_table(
        "daily_surge_theme_groups",
        sa.Column("trade_date", sa.Date(), primary_key=True),
        sa.Column("theme_id", sa.Integer(), primary_key=True),
        sa.Column("direction", sa.String(5), primary_key=True),
        sa.Column("theme_name", sa.String(100), nullable=False),
        sa.Column("stock_count", sa.Integer(), nullable=False),
        sa.Column("avg_change_rate", sa.Float(), nullable=False),
        sa.Column("value_sum", sa.Float(), nullable=False),
        sa.Column("leader_ticker", sa.String(20), nullable=False),
        sa.Column("leader_name", sa.String(100), nullable=False),
        sa.Column("members", jsonb, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("theme_source", sa.String(10), nullable=False, server_default="kis"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "daily_surge_notes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("scope", sa.String(10), nullable=False),
        sa.Column("target", sa.String(20), nullable=False),
        sa.Column("note", sa.String(300), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("trade_date", "scope", "target", name="uq_daily_surge_notes_target"),
    )
    op.create_index("ix_daily_surge_notes_trade_date", "daily_surge_notes", ["trade_date"])


def downgrade() -> None:
    op.drop_index("ix_daily_surge_notes_trade_date", table_name="daily_surge_notes")
    op.drop_table("daily_surge_notes")
    op.drop_table("daily_surge_theme_groups")
    op.drop_index("ix_daily_surge_stocks_trade_date", table_name="daily_surge_stocks")
    op.drop_table("daily_surge_stocks")

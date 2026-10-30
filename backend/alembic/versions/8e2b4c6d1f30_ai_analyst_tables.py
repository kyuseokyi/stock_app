"""AI 시황 분석 테이블 — ai_daily_briefings(일별 모닝 브리핑), ai_stock_evaluations(스크리너 종목 정성 분석 캐시).

스펙 docs/superpowers/specs/2026-10-30-market-analyst-service-spec.md §3.1.
유니크 제약 이름은 스펙의 uq_ticker_date 대신 uq_ai_stock_eval_ticker_date(다른 테이블과 겹치지 않게).

Revision ID: 8e2b4c6d1f30
Revises: 5c1e9a7d3b20
Create Date: 2026-10-30
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "8e2b4c6d1f30"
down_revision = "5c1e9a7d3b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_daily_briefings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date(), nullable=False, unique=True),
        sa.Column("headline", sa.String(255), nullable=False),
        sa.Column("us_market_summary", sa.Text(), nullable=False),
        sa.Column("kr_impact_summary", sa.Text(), nullable=False),
        sa.Column("bullish_sectors", postgresql.JSONB(), nullable=False),
        sa.Column("bearish_sectors", postgresql.JSONB(), nullable=False),
        sa.Column("macro_checkpoints", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("idx_ai_daily_briefings_date", "ai_daily_briefings", ["date"])

    op.create_table(
        "ai_stock_evaluations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("hook_summary", sa.String(255), nullable=False),
        sa.Column("growth_quality", sa.String(50), nullable=False),
        sa.Column("financial_quality_note", sa.Text(), nullable=False),
        sa.Column("red_flag_level", sa.String(20), nullable=False),
        sa.Column("red_flags", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("ticker", "date", name="uq_ai_stock_eval_ticker_date"),
    )
    op.create_index("idx_ai_stock_eval_date", "ai_stock_evaluations", ["date"])


def downgrade() -> None:
    op.drop_index("idx_ai_stock_eval_date", table_name="ai_stock_evaluations")
    op.drop_table("ai_stock_evaluations")
    op.drop_index("idx_ai_daily_briefings_date", table_name="ai_daily_briefings")
    op.drop_table("ai_daily_briefings")

"""AI 요약 근거 기사 — ai_daily_briefings.sources · ai_stock_evaluations.sources (JSONB, nullable)

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §4
옛 행은 NULL 로 두고 API 가 [] 로 내려준다(값 채우기 없음).

Revision ID: d5e7f9a1b3c5
Revises: c4d6e8f0a2b3
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d5e7f9a1b3c5"
down_revision = "c4d6e8f0a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ai_daily_briefings", sa.Column("sources", postgresql.JSONB(), nullable=True))
    op.add_column("ai_stock_evaluations", sa.Column("sources", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("ai_stock_evaluations", "sources")
    op.drop_column("ai_daily_briefings", "sources")

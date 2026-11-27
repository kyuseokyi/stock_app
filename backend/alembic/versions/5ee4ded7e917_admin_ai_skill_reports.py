"""관리자 AI Lab 종목 심층 분석 리포트(B단계) — admin_ai_skill_reports

- (ticker, as_of_date) 유니크(다시 분석하면 upsert), as_of_date DESC 인덱스(최근 기준일 목록).
- 공시 촉매는 DART 공시 기준(dart_catalysts). 외부 기사 데이터 컬럼은 두지 않는다.
- 새 표만 만든다(무중단 배포 중 옛 컨테이너와 함께 떠도 안전).
설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절

Revision ID: 5ee4ded7e917
Revises: f6b8d0a2c4e7
Create Date: 2026-11-27
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "5ee4ded7e917"
down_revision = "f6b8d0a2c4e7"
branch_labels = None
depends_on = None

_JSONB = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "admin_ai_skill_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ticker", sa.String(20), nullable=False),
        sa.Column("stock_name", sa.String(100), nullable=False),
        sa.Column("as_of_date", sa.Date(), nullable=False),
        sa.Column("quant_facts", _JSONB, nullable=False),
        sa.Column("sepa_analysis", _JSONB, nullable=False),
        sa.Column("vibe_backtest", _JSONB, nullable=False),
        sa.Column("exposure_and_sizing", _JSONB, nullable=False),
        sa.Column("logic_chain_and_thesis", _JSONB, nullable=False),
        sa.Column("ev_scenarios", _JSONB, nullable=False),
        sa.Column("k_dart_and_valuation", _JSONB, nullable=False),
        sa.Column("dart_catalysts", _JSONB, nullable=False),
        sa.Column("overall_verdict", sa.String(50), nullable=False),
        sa.Column("executive_summary", sa.Text(), nullable=False),
        sa.Column("model_name", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("ticker", "as_of_date", name="uq_admin_skill_report_ticker_date"),
    )
    op.create_index("idx_admin_skill_reports_date", "admin_ai_skill_reports", [sa.text("as_of_date DESC")])


def downgrade() -> None:
    op.drop_index("idx_admin_skill_reports_date", table_name="admin_ai_skill_reports")
    op.drop_table("admin_ai_skill_reports")

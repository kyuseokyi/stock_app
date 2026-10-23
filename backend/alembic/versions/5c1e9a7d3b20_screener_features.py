"""스크리너 탭 보이기 스위치 — screener_features(FINDER=조건검색, PATTERNS=차트 패턴). 행이 없으면 꺼짐(숨김)이라 시드 없음.

Revision ID: 5c1e9a7d3b20
Revises: f4a5b6c7d8e9
Create Date: 2026-10-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "5c1e9a7d3b20"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "screener_features",
        sa.Column("key", sa.String(30), primary_key=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("screener_features")

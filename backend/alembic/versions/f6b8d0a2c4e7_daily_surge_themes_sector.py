"""급등락 분석 — 종목별 소속 테마 목록·업종 이름, 묶음 테마 크기

2026-11-27 상용에서 '테마 묶음 없음'이 대부분으로 보임 → 묶음이 없는 종목도 소속 테마를 보여 주고 업종도 표시.
- 컬럼 추가만(무중단 배포 중 옛 컨테이너와 함께 떠도 안전). 기존 행은 빈 목록·NULL.

Revision ID: f6b8d0a2c4e7
Revises: e5a7c9b1d3f6
Create Date: 2026-11-27
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f6b8d0a2c4e7"
down_revision = "e5a7c9b1d3f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daily_surge_stocks", sa.Column("themes", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                                                  server_default=sa.text("'[]'::jsonb")))
    op.add_column("daily_surge_stocks", sa.Column("sector_name", sa.String(100), nullable=True))
    op.add_column("daily_surge_theme_groups", sa.Column("theme_size", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("daily_surge_theme_groups", "theme_size")
    op.drop_column("daily_surge_stocks", "sector_name")
    op.drop_column("daily_surge_stocks", "themes")

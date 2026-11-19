"""회원별 시세 열람 권한 — users.market_data_access(기본 false)

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 2-2(A안 시세 비노출)
전체 스위치(screener_features.MARKET_DATA)가 꺼져 있어도 이 값이 true 인 회원은 stock_api 시세를 볼 수 있다.
운영자 본인 확인용 — 관리자(ADMIN)는 이 값과 무관하게 항상 허용.

Revision ID: a7c9e1b3d5f8
Revises: e6f8a0b2c4d7
Create Date: 2026-11-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7c9e1b3d5f8"
down_revision = "e6f8a0b2c4d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 기존 회원은 모두 false(권한 없음) — server_default 로 채운다
    op.add_column(
        "users",
        sa.Column("market_data_access", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "market_data_access")

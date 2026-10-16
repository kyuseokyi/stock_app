"""플랫폼별 단일 세션 — user_sessions(user_id, platform) → sid

Revision ID: e7f8a9b0c1d2
Revises: f2a3b4c5d6e7
Create Date: 2026-10-16
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sessions",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("platform", sa.String(16), primary_key=True),
        sa.Column("sid", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("platform IN ('web', 'app', 'admin')", name="ck_user_sessions_platform"),
    )


def downgrade() -> None:
    op.drop_table("user_sessions")

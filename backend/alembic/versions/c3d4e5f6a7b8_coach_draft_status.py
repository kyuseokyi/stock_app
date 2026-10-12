"""game_coach_messages: draft status + nullable published_at (Phase 5a)

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "game_coach_messages",
        sa.Column("status", sa.String(20), nullable=False, server_default="PUBLISHED"),
    )
    op.alter_column(
        "game_coach_messages", "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
        server_default=None,
        existing_server_default=sa.text("now()"),
    )


def downgrade() -> None:
    op.execute("UPDATE game_coach_messages SET published_at = now() WHERE published_at IS NULL")
    op.alter_column(
        "game_coach_messages", "published_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    op.drop_column("game_coach_messages", "status")

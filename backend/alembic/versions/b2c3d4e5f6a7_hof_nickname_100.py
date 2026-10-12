"""widen hall_of_fame.user_nickname to 100 (match User.nickname)

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-10-12
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "hall_of_fame", "user_nickname",
        existing_type=sa.String(50), type_=sa.String(100), existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "hall_of_fame", "user_nickname",
        existing_type=sa.String(100), type_=sa.String(50), existing_nullable=False,
    )

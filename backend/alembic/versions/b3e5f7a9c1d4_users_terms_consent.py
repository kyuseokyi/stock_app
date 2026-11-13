"""이용약관 동의 — users.terms_version · users.terms_agreed_at (기존 행은 NULL = 미동의)

설계: docs/superpowers/specs/2026-11-13-terms-consent-review-login-design.md §1

Revision ID: b3e5f7a9c1d4
Revises: a7d1c3e5f902
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b3e5f7a9c1d4"
down_revision = "a7d1c3e5f902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_version", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("terms_agreed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "terms_agreed_at")
    op.drop_column("users", "terms_version")

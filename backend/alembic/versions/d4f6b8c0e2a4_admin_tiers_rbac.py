"""관리자 등급별 권한(RBAC) — users.admin_tier·custom_permissions, admin_tier_policies 표

명세: docs/admin_rbac_permissions_spec_and_plan.md
- 추가만 한다(무중단 배포 중 옛 컨테이너가 같이 떠 있어도 안전).
- 슈퍼가 아닌 기존 관리자는 OPERATOR(계정 관리만 빼고 전부 — 등급 도입 전과 같은 동작)로 채운다.
- 등급 표는 비워 둔다 — 행이 없으면 코드 기본값(shared/admin_permissions.DEFAULT_POLICIES)을 쓴다.

Revision ID: d4f6b8c0e2a4
Revises: c3e5a7b9d1f2
Create Date: 2026-11-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d4f6b8c0e2a4"
down_revision = "c3e5a7b9d1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("admin_tier", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("custom_permissions", sa.Text(), nullable=True))
    op.create_table(
        "admin_tier_policies",
        sa.Column("tier", sa.String(20), primary_key=True),
        sa.Column("permissions_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute(
        "UPDATE users SET admin_tier = 'OPERATOR' "
        "WHERE role = 'ADMIN' AND is_super_admin = FALSE AND admin_tier IS NULL"
    )


def downgrade() -> None:
    op.drop_table("admin_tier_policies")
    op.drop_column("users", "custom_permissions")
    op.drop_column("users", "admin_tier")

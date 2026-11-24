"""users.is_super_admin — 슈퍼 관리자 표시(관리자 계정 생성·비활성화·비밀번호 초기화 권한)

컬럼 추가만 한다(server_default false) — 무중단 배포 중 옛 컨테이너가 같이 떠 있어도 안전.
기존 관리자(role=ADMIN) 행은 모두 시드로 만든 계정이라 슈퍼 관리자로 올린다(이메일을 코드에 박지 않는다).

Revision ID: c3e5a7b9d1f2
Revises: b1d3f5a7c9e2
Create Date: 2026-11-24
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c3e5a7b9d1f2"
down_revision = "b1d3f5a7c9e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_super_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.execute("UPDATE users SET is_super_admin = TRUE WHERE role = 'ADMIN'")


def downgrade() -> None:
    op.drop_column("users", "is_super_admin")

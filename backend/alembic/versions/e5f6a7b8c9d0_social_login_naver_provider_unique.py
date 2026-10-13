"""social login: auth_provider += NAVER, users(provider, provider_id) unique

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-13
"""
from __future__ import annotations

from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG enum 값 추가는 트랜잭션 밖에서 안전 — autocommit 블록 + IF NOT EXISTS(재실행 무해)
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE auth_provider ADD VALUE IF NOT EXISTS 'NAVER'")
    # (provider, provider_id) 유니크 — 둘 다 NULL 인 기존 행(관리자·게스트)은 PG 에서 서로 충돌하지 않는다
    op.create_unique_constraint(
        "uq_users_provider_provider_id", "users", ["provider", "provider_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_users_provider_provider_id", "users", type_="unique")
    # auth_provider 의 'NAVER' 값은 되돌리지 않는다(no-op).
    # PG 는 enum 값 삭제(DROP VALUE)를 지원하지 않으며, 타입 재생성은 NAVER 사용자 행이 있으면 실패한다.

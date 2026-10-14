"""아카데미 시드 문항 1번 방향 용어 LONG → 상승(화면 용어 통일)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-14

- 시드 원문 그대로인 행만 갱신(관리자가 고친 문항은 건드리지 않음).
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None

OLD = "5배 레버리지로 LONG 진입한 뒤 주가가 16% 하락하면 어떻게 될까요?"
NEW = "5배 레버리지로 상승에 건 뒤 주가가 16% 하락하면 어떻게 될까요?"


def _swap(src: str, dst: str) -> None:
    op.execute(
        sa.text("UPDATE academy_questions SET question = :dst WHERE id = 1 AND question = :src")
        .bindparams(src=src, dst=dst)
    )


def upgrade() -> None:
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)

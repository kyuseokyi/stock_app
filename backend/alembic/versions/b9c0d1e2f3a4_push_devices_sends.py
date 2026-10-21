"""펀드 리포트 알림 — push_devices(기기 토큰) · push_sends(발송 이력) + 기본 템플릿

Revision ID: b9c0d1e2f3a4
Revises: f3a4b5c6d7e8
Create Date: 2026-10-21
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b9c0d1e2f3a4"
down_revision = "f3a4b5c6d7e8"
branch_labels = None
depends_on = None

SEED_TITLE = "수익률 리포트 업데이트"
SEED_BODY = "{date} 수익률 리포트가 올라왔어요"


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token", sa.String(255), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(16), nullable=False),
        sa.Column("fund_notice", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])
    op.create_table(
        "push_sends",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("ref_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("body", sa.String(500), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("target_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("success_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("failure_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("push_templates.id", ondelete="SET NULL")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_push_sends_status_scheduled_at", "push_sends", ["status", "scheduled_at"])
    op.create_index("ix_push_sends_kind_ref_date", "push_sends", ["kind", "ref_date"])
    op.execute(
        sa.text("INSERT INTO push_templates (title, body) VALUES (:t, :b)").bindparams(t=SEED_TITLE, b=SEED_BODY)
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM push_templates WHERE title = :t AND body = :b").bindparams(t=SEED_TITLE, b=SEED_BODY)
    )
    op.drop_index("ix_push_sends_kind_ref_date", table_name="push_sends")
    op.drop_index("ix_push_sends_status_scheduled_at", table_name="push_sends")
    op.drop_table("push_sends")
    op.drop_index("ix_push_devices_user_id", table_name="push_devices")
    op.drop_table("push_devices")

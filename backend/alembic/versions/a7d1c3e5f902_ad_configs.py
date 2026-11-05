"""광고 원격 설정 — ad_configs + 전체 스위치·슬롯 기본 행(모두 꺼짐, 하우스 배너)

명세: docs/ad_monetization_spec_and_plan.md §3-1

Revision ID: a7d1c3e5f902
Revises: 8e2b4c6d1f30
Create Date: 2026-11-05
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a7d1c3e5f902"
down_revision = "8e2b4c6d1f30"
branch_labels = None
depends_on = None

_GAME = ("실시간 차트 트레이딩 게임", "가상 자금으로 실전 감각을 키워보세요.", "/game")
# (slot_key, infeed_interval, 하우스 배너) — 서비스 기본값(apps/blog/services/ad_config.py SLOT_DEFAULTS)과 같게 유지
_ROWS = (
    ("GLOBAL_WEB", 7, (None, None, None)),
    ("GLOBAL_MOBILE", 7, (None, None, None)),
    ("WEB_HOME_SIDEBAR", 7, _GAME),
    ("WEB_POST_LIST_INFEED", 5, _GAME),
    ("WEB_POST_DETAIL_BOTTOM", 7, _GAME),
    ("WEB_SCREENER_FOOTER", 7, _GAME),
    ("MOB_HOME_FEED_NATIVE", 7, _GAME),
    ("MOB_COMMUNITY_INFEED", 7, _GAME),
    ("MOB_POST_DETAIL_BOTTOM", 7, _GAME),
)


def upgrade() -> None:
    table = op.create_table(
        "ad_configs",
        sa.Column("slot_key", sa.String(50), primary_key=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("provider", sa.String(20), server_default="HOUSE", nullable=False),
        sa.Column("infeed_interval", sa.Integer(), server_default="7", nullable=False),
        sa.Column("house_title", sa.String(120), nullable=True),
        sa.Column("house_description", sa.String(255), nullable=True),
        sa.Column("house_target_path", sa.String(255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(100), nullable=True),
    )
    op.bulk_insert(table, [
        {"slot_key": key, "infeed_interval": interval, "house_title": title, "house_description": desc,
         "house_target_path": path}
        for key, interval, (title, desc, path) in _ROWS
    ])


def downgrade() -> None:
    op.drop_table("ad_configs")

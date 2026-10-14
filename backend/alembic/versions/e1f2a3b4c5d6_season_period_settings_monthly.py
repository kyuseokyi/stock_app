"""시즌 기간(period)·게임 설정(game_settings)·월간 랭킹 기록(period_type)

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-10-14

- game_seasons.period: month|quarter(기존 행 month)
- game_settings: 운영 설정(key → JSONB)
- weekly_ranking_results.period_type: week|month, 유니크 제약에 period_type 포함
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None

RESULTS = "weekly_ranking_results"


def upgrade() -> None:
    op.add_column(
        "game_seasons",
        sa.Column("period", sa.String(length=10), nullable=False, server_default="month"),
    )
    op.create_check_constraint("ck_game_seasons_period", "game_seasons", "period IN ('month','quarter')")

    op.create_table(
        "game_settings",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("value", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )

    op.add_column(
        RESULTS, sa.Column("period_type", sa.String(length=10), nullable=False, server_default="week"),
    )
    op.drop_constraint("uq_weekly_result_rank", RESULTS, type_="unique")
    op.drop_constraint("uq_weekly_result_user", RESULTS, type_="unique")
    op.create_unique_constraint(
        "uq_weekly_result_rank", RESULTS, ["season_id", "period_type", "week_start", "rank"]
    )
    op.create_unique_constraint(
        "uq_weekly_result_user", RESULTS, ["season_id", "period_type", "week_start", "user_id"]
    )


def downgrade() -> None:
    # 옛 제약(period_type 없음) 복원 전 월간 행을 지운다 — 되돌리면 월간 기록은 사라진다.
    op.execute(sa.text(f"DELETE FROM {RESULTS} WHERE period_type = 'month'"))
    op.drop_constraint("uq_weekly_result_rank", RESULTS, type_="unique")
    op.drop_constraint("uq_weekly_result_user", RESULTS, type_="unique")
    op.create_unique_constraint("uq_weekly_result_rank", RESULTS, ["season_id", "week_start", "rank"])
    op.create_unique_constraint("uq_weekly_result_user", RESULTS, ["season_id", "week_start", "user_id"])
    op.drop_column(RESULTS, "period_type")

    op.drop_table("game_settings")

    op.drop_constraint("ck_game_seasons_period", "game_seasons", type_="check")
    op.drop_column("game_seasons", "period")

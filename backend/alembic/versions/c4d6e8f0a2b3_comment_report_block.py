"""댓글 신고·차단 — boards.comments_enabled 기본값 false, comment_reports·user_blocks, 숨김·작성 금지 컬럼

설계: docs/superpowers/specs/2026-11-13-comment-report-block-design.md §1·§2
- comments_enabled 는 server_default 만 바꾼다. 기존 게시판 행 값은 그대로 둔다(값 변경 쿼리 없음).
- 새 컬럼은 모두 nullable(기존 행 NULL = 공개·정상).

Revision ID: c4d6e8f0a2b3
Revises: b3e5f7a9c1d4
Create Date: 2026-11-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c4d6e8f0a2b3"
down_revision = "b3e5f7a9c1d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("boards", "comments_enabled", server_default=sa.text("false"))

    op.add_column("blog_comments", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("comment_banned_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "comment_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("comment_id", sa.Integer(), sa.ForeignKey("blog_comments.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("reporter_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("comment_id", "reporter_id", name="uq_comment_reports_comment_reporter"),
        sa.CheckConstraint("reason IN ('abuse','spam','sexual','privacy','scam','other')",
                           name="ck_comment_reports_reason"),
        sa.CheckConstraint("status IN ('pending','dismissed','actioned')", name="ck_comment_reports_status"),
    )
    op.create_index("ix_comment_reports_reporter_id", "comment_reports", ["reporter_id"])
    op.create_index("ix_comment_reports_status", "comment_reports", ["status"])

    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("blocked_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_user_blocks_blocked_id", "user_blocks", ["blocked_id"])


def downgrade() -> None:
    op.drop_index("ix_user_blocks_blocked_id", table_name="user_blocks")
    op.drop_table("user_blocks")
    op.drop_index("ix_comment_reports_status", table_name="comment_reports")
    op.drop_index("ix_comment_reports_reporter_id", table_name="comment_reports")
    op.drop_table("comment_reports")
    op.drop_column("users", "comment_banned_at")
    op.drop_column("blog_comments", "hidden_at")
    op.alter_column("boards", "comments_enabled", server_default=sa.text("true"))

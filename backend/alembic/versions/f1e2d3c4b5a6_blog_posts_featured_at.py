"""blog_posts.featured_at 추가 (홈 추천 큐레이션)

Revision ID: f1e2d3c4b5a6
Revises: cf0877c663a1
Create Date: 2026-09-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, Sequence[str], None] = "cf0877c663a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "blog_posts",
        sa.Column("featured_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_blog_posts_featured_at", "blog_posts", ["featured_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_blog_posts_featured_at", table_name="blog_posts")
    op.drop_column("blog_posts", "featured_at")

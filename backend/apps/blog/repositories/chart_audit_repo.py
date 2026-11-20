"""차트 포함 글 점검(관리자) DB 접근 — 본문에 내장 이미지·차트 표식이 있을 수 있는 글만 후보로 좁힌다.

설계: docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3-6절, 6절 P1 7번
정확한 판정(이미지 태그 단위)은 서비스가 파이썬에서 한다. 여기서는 LIMIT 을 걸지 않는다 —
후보 중 실제로는 0건인 글(본문 글자로만 '차트 스냅샷' 이 들어간 글 등)을 뺀 뒤에 잘라야 해당 글이 잘리지 않는다.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import BlogPost, Board

CHART_ALT = "차트 스냅샷"


async def candidate_rows(db: AsyncSession) -> list:
    """(id, title, board_id, board_name, created_at, updated_at, featured_at, content) 최신순.

    ilike — PG 의 LIKE 는 대소문자를 구분해 'DATA:IMAGE' 를 놓친다.
    """
    stmt = (
        select(
            BlogPost.id,
            BlogPost.title,
            BlogPost.board_id,
            Board.name.label("board_name"),
            BlogPost.created_at,
            BlogPost.updated_at,
            BlogPost.featured_at,
            BlogPost.content,
        )
        .outerjoin(Board, Board.id == BlogPost.board_id)
        .where(or_(BlogPost.content.ilike("%data:image/%"), BlogPost.content.like(f"%{CHART_ALT}%")))
        .order_by(BlogPost.created_at.desc(), BlogPost.id.desc())
    )
    return list((await db.execute(stmt)).all())

"""홈 추천(featured) 필터·정렬·토글 crud 회귀 테스트.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다.
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.blog import crud, schemas
from shared.models import Base, BlogPost, Board


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed(session, n: int = 3) -> tuple[Board, list[BlogPost]]:
    board = Board(name="테스트", order_index=0)
    session.add(board)
    await session.commit()
    await session.refresh(board)
    posts = []
    for i in range(n):
        p = BlogPost(board_id=board.id, title=f"글{i}", content="<p>x</p>")
        session.add(p)
        posts.append(p)
    await session.commit()
    for p in posts:
        await session.refresh(p)
    return board, posts


async def test_featured_none_returns_all(session):
    _, posts = await _seed(session)
    total, items = await crud.list_blogs(session)
    assert total == 3
    assert len(items) == 3


async def test_featured_filter_and_order(session):
    _, posts = await _seed(session)
    # feature 순서를 id 순서와 반대로: posts[2] 를 먼저, posts[0] 를 나중에 추천.
    # featured_at DESC 면 [posts[0], posts[2]] (나중에 켠 게 위),
    # id DESC tie-break 만이라면 [posts[2], posts[0]] 가 나온다 → 정렬 주체를 구분한다.
    await crud.update_blog(session, posts[2], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))

    total, items = await crud.list_blogs(session, featured=True)
    assert total == 2
    assert [p.id for p in items] == [posts[0].id, posts[2].id]


async def test_unfeature_removes_from_list(session):
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=False))
    total, items = await crud.list_blogs(session, featured=True)
    assert total == 0
    assert items == []


async def test_update_other_field_keeps_featured(session):
    """featured 를 안 보낸 수정은 featured_at 을 건드리지 않는다(회귀 방지)."""
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(title="수정됨"))
    total, _ = await crud.list_blogs(session, featured=True)
    assert total == 1


async def test_refeature_preserves_original_time(session):
    """이미 추천된 글에 featured=True 재전송해도 featured_at 이 바뀌지 않는다."""
    _, posts = await _seed(session)
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    first = posts[0].featured_at
    assert first is not None
    await crud.update_blog(session, posts[0], schemas.BlogUpdate(featured=True))
    assert posts[0].featured_at == first

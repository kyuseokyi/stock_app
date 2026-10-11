"""트레이딩 게임 핵심 모델/제약 검증.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다
(기존 tests/test_blog_featured.py 패턴). sqlite의 FK 강제는 기본 꺼져 있어
connect 시 PRAGMA foreign_keys=ON 으로 켠다. UUID 는 GUID TypeDecorator 가
sqlite 에선 CHAR(32) 로 동작하므로 create_all 이 정상 수행된다.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameSeason, GameAccount, GamePosition


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _make_user(session, nickname: str = "플레이어") -> User:
    u = User(nickname=nickname, role=UserRole.FREE, is_active=True)
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


async def _make_season(session, end_at=None, number: int = 1) -> GameSeason:
    s = GameSeason(
        season_number=number,
        ticker="005930",
        stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
        end_at=end_at,
        status="ACTIVE",
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


async def test_season_open_ended_allows_null_end(session):
    s = await _make_season(session, end_at=None)
    assert s.id is not None
    assert s.end_at is None  # 무기한/미정 시즌


async def test_account_unique_per_user_season(session):
    u = await _make_user(session)
    s = await _make_season(session)
    session.add(GameAccount(user_id=u.id, season_id=s.id))
    await session.commit()
    session.add(GameAccount(user_id=u.id, season_id=s.id))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_position_open_links_account(session):
    u = await _make_user(session)
    s = await _make_season(session)
    acc = GameAccount(user_id=u.id, season_id=s.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    pos = GamePosition(
        account_id=acc.id, side="LONG", entry_price=71000,
        size_amount=1000000, leverage=2,
    )
    session.add(pos)
    await session.commit()
    await session.refresh(pos)
    assert isinstance(pos.id, uuid.UUID)
    assert pos.status == "OPEN"  # default


async def test_account_fk_rejects_missing_user(session):
    s = await _make_season(session)
    session.add(GameAccount(user_id=999999, season_id=s.id))
    with pytest.raises(IntegrityError):
        await session.commit()

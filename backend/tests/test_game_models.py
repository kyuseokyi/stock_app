"""트레이딩 게임 핵심 모델/제약 검증.

공유 DB 하니스가 없어 self-contained aiosqlite 인메모리 세션을 쓴다
(기존 tests/test_blog_featured.py 패턴). sqlite의 FK 강제는 기본 꺼져 있어
connect 시 PRAGMA foreign_keys=ON 으로 켠다. UUID 는 GUID TypeDecorator 가
sqlite 에선 CHAR(32) 로 동작하므로 create_all 이 정상 수행된다.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import (
    GameAccount,
    GameCoachMessage,
    GamePosition,
    GameSeason,
    GameTrade,
    HallOfFame,
)


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
    assert pos.account_id == acc.id
    await session.refresh(acc, ["positions"])
    assert pos.id in [p.id for p in acc.positions]


async def test_account_fk_rejects_missing_user(session):
    s = await _make_season(session)
    session.add(GameAccount(user_id=999999, season_id=s.id))
    with pytest.raises(IntegrityError):
        await session.commit()


async def _make_account(session):
    u = await _make_user(session)
    s = await _make_season(session)
    acc = GameAccount(user_id=u.id, season_id=s.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    return u, s, acc


async def test_trade_decimal_roundtrip(session):
    _, _, acc = await _make_account(session)
    t = GameTrade(
        account_id=acc.id, side="LONG",
        entry_price=Decimal("71000"), exit_price=Decimal("72000"),
        pnl_amount=Decimal("140000"), roi_pct=Decimal("14.0000"),
        closed_reason="MANUAL",
    )
    session.add(t)
    await session.commit()
    tid = t.id
    session.expire_all()
    got = await session.get(GameTrade, tid)
    assert isinstance(got.entry_price, Decimal)
    assert isinstance(got.roi_pct, Decimal)
    assert got.entry_price == Decimal("71000")
    assert got.exit_price == Decimal("72000")
    assert got.pnl_amount == Decimal("140000")
    assert got.roi_pct == Decimal("14.0000")


async def test_hall_of_fame_and_coach_insert(session):
    u = await _make_user(session)
    s = await _make_season(session)
    h = HallOfFame(
        season_id=s.id, rank=1, user_id=u.id, user_nickname="플레이어",
        final_roi=Decimal("25.5"), final_asset=Decimal("12550000"),
        win_rate=Decimal("60.00"),
    )
    c = GameCoachMessage(
        season_id=s.id, target_date=date(2026, 10, 2), coach_type="MORNING",
        title="모닝 브리핑", summary_nudge="오늘은 관망", content_md="# 본문",
        support_price=Decimal("70000"), resistance_price=Decimal("73000"),
    )
    session.add_all([h, c])
    await session.commit()
    await session.refresh(h)
    await session.refresh(c)
    assert h.id is not None
    assert c.id is not None


async def test_guid_roundtrip(session):
    _, _, acc = await _make_account(session)
    aid = acc.id
    session.expire_all()
    got = (await session.execute(
        select(GameAccount).where(GameAccount.id == aid)
    )).scalar_one()
    assert isinstance(got.id, uuid.UUID)
    assert got.id == aid


async def test_unique_season_number(session):
    await _make_season(session, number=1)
    with pytest.raises(IntegrityError):
        await _make_season(session, number=1)
    await session.rollback()


async def test_unique_hall_of_fame_rank(session):
    u1 = await _make_user(session, "a")
    u2 = await _make_user(session, "b")
    s = await _make_season(session)

    def hof(u):
        return HallOfFame(
            season_id=s.id, rank=1, user_id=u.id, user_nickname="x",
            final_roi=Decimal("1"), final_asset=Decimal("1"), win_rate=Decimal("1"),
        )

    session.add(hof(u1))
    await session.commit()
    session.add(hof(u2))
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


async def test_unique_coach_slot(session):
    s = await _make_season(session)

    def msg():
        return GameCoachMessage(
            season_id=s.id, target_date=date(2026, 10, 2), coach_type="MORNING",
            title="t", summary_nudge="n", content_md="c",
        )

    session.add(msg())
    await session.commit()
    session.add(msg())
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()


async def test_delete_account_cascades_positions(session):
    u = await _make_user(session)
    s = await _make_season(session)
    acc = GameAccount(user_id=u.id, season_id=s.id)
    session.add(acc)
    await session.commit()
    await session.refresh(acc)
    pos = GamePosition(
        account_id=acc.id, side="LONG", entry_price=71000, size_amount=1000000
    )
    session.add(pos)
    await session.commit()
    # load children, then delete parent — must NOT raise (cascade, not NULL-ing)
    await session.refresh(acc, ["positions"])
    await session.delete(acc)
    await session.commit()
    remaining = (await session.execute(select(GamePosition))).scalars().all()
    assert remaining == []

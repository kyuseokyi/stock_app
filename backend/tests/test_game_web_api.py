"""트레이딩 게임 Phase 6a — 유저 웹용 공개 API 테스트."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.auth import get_current_user
from shared.database import get_db
from shared.models import Base
from shared.game_models import GameSeason
from apps.trading_game.main import app


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def session(maker):
    async with maker() as s:
        yield s


@pytest.fixture
async def client(maker):
    async def _db():
        async with maker() as s:
            yield s

    async def _no_user():  # 공개 엔드포인트 — 인증 의존성이 호출되면 실패시키기 위함
        raise AssertionError("공개 엔드포인트가 인증을 요구함")

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _no_user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _seed_season(db, *, status: str = "ACTIVE", number: int = 1) -> GameSeason:
    season = GameSeason(
        season_number=number, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc),
        end_at=datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def test_active_season_null_when_none(client, session):
    await _seed_season(session, status="READY")
    r = await client.get("/api/game/seasons/active")
    assert r.status_code == 200
    assert r.json() is None


async def test_active_season_returns_public_fields(client, session):
    season = await _seed_season(session)
    r = await client.get("/api/game/seasons/active")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == season.id
    assert body["season_number"] == 1
    assert body["ticker"] == "005930"
    assert body["stock_name"] == "삼성전자"
    assert body["status"] == "ACTIVE"
    assert body["start_at"].startswith("2026-10-01")
    assert body["end_at"].startswith("2026-11-01")


async def _seed_hof(db, season, rank: int, nickname: str) -> None:
    from decimal import Decimal

    from shared.game_models import HallOfFame

    db.add(HallOfFame(
        season_id=season.id, rank=rank, user_nickname=nickname, final_roi=Decimal("12.5"),
        final_asset=Decimal("11250000"), win_rate=Decimal("60"), trading_mbti="ENTJ",
    ))
    await db.commit()


async def test_hall_of_fame_includes_season_number(client, session):
    s1 = await _seed_season(session, status="CLOSED", number=7)
    s2 = await _seed_season(session, status="CLOSED", number=8)
    await _seed_hof(session, s1, 2, "b")
    await _seed_hof(session, s1, 1, "a")
    await _seed_hof(session, s2, 1, "c")

    r = await client.get("/api/game/hall-of-fame")
    assert r.status_code == 200
    rows = r.json()
    # 정렬 불변: season_id desc, rank asc
    assert [(x["season_id"], x["rank"]) for x in rows] == [(s2.id, 1), (s1.id, 1), (s1.id, 2)]
    # season_number 는 id 가 아니라 시즌 번호
    assert [x["season_number"] for x in rows] == [8, 7, 7]
    assert set(rows[0]) == {
        "season_id", "season_number", "rank", "nickname", "final_roi", "final_asset", "win_rate", "trading_mbti",
    }

    r = await client.get("/api/game/hall-of-fame", params={"season_id": s1.id})
    assert [(x["season_number"], x["nickname"]) for x in r.json()] == [(7, "a"), (7, "b")]

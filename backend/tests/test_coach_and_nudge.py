"""트레이딩 게임 Phase 5a — 데일리 코치 + 스마트 넛지 테스트."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import GameCoachMessage, GameSeason


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


async def _seed_season(db, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 0, 0, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def test_coach_message_draft_has_null_published_at(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="MORNING",
        title="t", summary_nudge="s", content_md="c", status="DRAFT", published_at=None,
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "DRAFT"
    assert msg.published_at is None


async def test_coach_message_status_defaults_to_published(session):
    season = await _seed_season(session)
    msg = GameCoachMessage(
        season_id=season.id, target_date=date(2026, 10, 13), coach_type="EVENING",
        title="t", summary_nudge="s", content_md="c",
        published_at=datetime(2026, 10, 13, 11, 0, tzinfo=timezone.utc),
    )
    session.add(msg)
    await session.commit()
    await session.refresh(msg)
    assert msg.status == "PUBLISHED"


# ---------------------------------------------------------------- nudge engine
from apps.trading_game.services import nudge_engine


def _codes(nudges):
    return [n.code for n in nudges]


@pytest.mark.parametrize("rsi, expected", [(79.99, []), (80.0, ["OVERBOUGHT_CHASE"]), (None, [])])
def test_open_overbought_threshold(rsi, expected):
    assert _codes(nudge_engine.nudges_for_open(side="LONG", ratio=0.25, leverage=1, rsi=rsi)) == expected


def test_open_short_never_overbought_warning():
    assert nudge_engine.nudges_for_open(side="SHORT", ratio=0.25, leverage=1, rsi=95.0) == []


@pytest.mark.parametrize("ratio, leverage, expected", [
    (1.0, 5, ["OVERLEVERAGE"]),
    (1.0, 2, []),
    (0.5, 5, []),
])
def test_open_overleverage(ratio, leverage, expected):
    assert _codes(nudge_engine.nudges_for_open(side="SHORT", ratio=ratio, leverage=leverage, rsi=None)) == expected


def test_open_warning_and_advice_together_in_order():
    nudges = nudge_engine.nudges_for_open(side="LONG", ratio=1.0, leverage=5, rsi=85.0)
    assert _codes(nudges) == ["OVERBOUGHT_CHASE", "OVERLEVERAGE"]
    assert [n.type for n in nudges] == ["WARNING", "ADVICE"]


@pytest.mark.parametrize("reason, roi, expected", [
    ("STOP_LOSS", Decimal("-0.99"), []),
    ("STOP_LOSS", Decimal("-1"), ["PRINCIPLED_STOP"]),
    ("MANUAL", Decimal("-2.5"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3"), ["PRINCIPLED_STOP"]),
    ("STOP_LOSS", Decimal("-3.01"), []),
    ("TAKE_PROFIT", Decimal("-2"), []),
    ("MARGIN_CALL", Decimal("-2"), []),
])
def test_close_principled_stop(reason, roi, expected):
    assert _codes(nudge_engine.nudges_for_close(closed_reason=reason, roi_pct=roi)) == expected


def test_nudge_to_dict_shape():
    n = nudge_engine.nudges_for_close(closed_reason="MANUAL", roi_pct=Decimal("-2"))[0]
    assert n.to_dict() == {"type": "PRAISE", "code": "PRINCIPLED_STOP", "message": n.message}
    assert n.message.startswith("💡")


# ---------------------------------------------------------------- RSI
import json

from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import rsi_service

# StockCharts "RSI" 예제 종가. 시트는 중간값 반올림으로 70.53/66.32 를 표기하지만,
# 반올림 없는 Wilder 계산의 정밀값은 70.4641 / 66.2496 이다.
_SC_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
              45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]


def test_wilder_rsi_hand_computed_period2():
    # 변화 +1,+1 → 시드 gain 1 / loss 0; -1 → 0.5/0.5; +1 → 0.75/0.25 → RS 3 → 75
    assert rsi_service.wilder_rsi([1, 2, 3, 2, 3], period=2) == pytest.approx(75.0)


def test_wilder_rsi_stockcharts_vector():
    assert rsi_service.wilder_rsi(_SC_CLOSES) == pytest.approx(70.4641, abs=1e-3)
    assert rsi_service.wilder_rsi(_SC_CLOSES + [46.00]) == pytest.approx(66.2496, abs=1e-3)


def test_wilder_rsi_all_gains_is_100_and_short_input_none():
    assert rsi_service.wilder_rsi([float(i) for i in range(1, 17)]) == 100.0
    assert rsi_service.wilder_rsi([1.0] * 14) is None  # period+1 미만


async def test_current_rsi_caches_closes_per_day():
    redis = fake_aioredis.FakeRedis(decode_responses=True)
    calls = []

    async def provider(ticker, today):
        calls.append((ticker, today))
        return _SC_CLOSES[:-1]  # 14개 + live 1개 = 15개

    today = date(2026, 10, 13)
    v1 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    v2 = await rsi_service.current_rsi(redis, "005930", Decimal("46.28"), today=today, closes_provider=provider)
    assert v1 == pytest.approx(70.4641, abs=1e-3)
    assert v2 == v1
    assert len(calls) == 1  # 두 번째는 캐시 적중
    cached = await redis.get("game:rsi:closes:005930:20261013")
    assert json.loads(cached) == _SC_CLOSES[:-1]
    assert await redis.ttl("game:rsi:closes:005930:20261013") > 0


async def test_current_rsi_returns_none_on_provider_error_and_does_not_cache_empty():
    redis = fake_aioredis.FakeRedis(decode_responses=True)

    async def boom(ticker, today):
        raise RuntimeError("clickhouse down")

    async def empty(ticker, today):
        return []

    today = date(2026, 10, 13)
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=boom) is None
    assert await rsi_service.current_rsi(redis, "005930", Decimal("1"), today=today, closes_provider=empty) is None
    assert await redis.get("game:rsi:closes:005930:20261013") is None


def test_fetch_closes_excludes_today(monkeypatch):
    from types import SimpleNamespace
    from apps.stock_api.services import clickhouse_source

    rows = [SimpleNamespace(date="2026-10-10", close=1.0),
            SimpleNamespace(date="2026-10-12", close=2.0),
            SimpleNamespace(date="2026-10-13", close=3.0)]  # 오늘 행은 제외되어야 함
    monkeypatch.setattr(clickhouse_source, "get_candles", lambda s, a, b: rows)
    assert rsi_service._fetch_closes_from_clickhouse("005930", date(2026, 10, 13)) == [1.0, 2.0]


# ---------------------------------------------------------------- coach service
from pydantic import ValidationError

from apps.trading_game.schemas.game_dtos import CoachUpsertRequest
from apps.trading_game.services import coach_service


def _req(season_id, action="draft", **over):
    kw = dict(
        season_id=season_id, target_date=date(2026, 10, 13), coach_type="MORNING",
        title="모닝 브리핑", summary_nudge="반도체 강세 출발", content_md="## 시황\n- 외국인 순매수",
        support_price=Decimal("70000"), resistance_price=Decimal("75000"), action=action,
    )
    kw.update(over)
    return CoachUpsertRequest(**kw)


async def _seed_admin(db) -> User:
    u = User(nickname="관리자", role=UserRole.ADMIN, is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


def test_upsert_request_rejects_support_not_below_resistance():
    with pytest.raises(ValidationError):
        _req(1, support_price=Decimal("75000"), resistance_price=Decimal("75000"))


async def test_draft_then_publish_then_redraft_conflict(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)

    draft = await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    assert draft.status == "DRAFT" and draft.published_at is None

    pub = await coach_service.upsert_coach_message(
        session, req=_req(season.id, action="publish", title="수정 제목"), author_id=admin.id
    )
    assert pub.id == draft.id  # 같은 슬롯 → 덮어쓰기
    assert pub.status == "PUBLISHED" and pub.published_at is not None
    assert pub.title == "수정 제목"

    with pytest.raises(coach_service.CoachError) as ei:
        await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    assert ei.value.code == "ALREADY_PUBLISHED"


async def test_upsert_unknown_season(session):
    admin = await _seed_admin(session)
    with pytest.raises(coach_service.CoachError) as ei:
        await coach_service.upsert_coach_message(session, req=_req(999), author_id=admin.id)
    assert ei.value.code == "SEASON_NOT_FOUND"


async def test_today_coach_only_published_and_both_slots(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)
    today = date(2026, 10, 13)

    assert await coach_service.today_coach(session, today) == (season.id, None, None)

    await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)  # 초안
    assert await coach_service.today_coach(session, today) == (season.id, None, None)

    await coach_service.upsert_coach_message(session, req=_req(season.id, action="publish"), author_id=admin.id)
    _, morning, evening = await coach_service.today_coach(session, today)
    assert morning is not None and evening is None

    await coach_service.upsert_coach_message(
        session, req=_req(season.id, action="publish", coach_type="EVENING", title="이브닝"),
        author_id=admin.id,
    )
    _, morning, evening = await coach_service.today_coach(session, today)
    assert morning.coach_type == "MORNING" and evening.coach_type == "EVENING"


async def test_today_coach_without_active_season(session):
    await _seed_season(session, status="FINISHED")
    assert await coach_service.today_coach(session, date(2026, 10, 13)) == (None, None, None)


async def test_list_slot_messages_includes_drafts_and_push_payload(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)
    await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    rows = await coach_service.list_slot_messages(session, season.id, date(2026, 10, 13))
    assert [r.status for r in rows] == ["DRAFT"]

    payload = coach_service.coach_push_payload(rows[0])
    assert payload["type"] == "coach"
    assert payload["coach_type"] == "MORNING"
    assert payload["target_date"] == "2026-10-13"
    assert Decimal(payload["support_price"]) == Decimal("70000")
    assert Decimal(payload["resistance_price"]) == Decimal("75000")


async def test_list_slot_messages_orders_morning_then_evening(session):
    season = await _seed_season(session)
    admin = await _seed_admin(session)
    await coach_service.upsert_coach_message(
        session, req=_req(season.id, coach_type="EVENING", title="이브닝"), author_id=admin.id)
    await coach_service.upsert_coach_message(session, req=_req(season.id), author_id=admin.id)
    rows = await coach_service.list_slot_messages(session, season.id, date(2026, 10, 13))
    assert [m.coach_type for m in rows] == ["MORNING", "EVENING"]


def test_kst_today_is_date():
    assert isinstance(coach_service.kst_today(), date)


def test_kst_today_crosses_midnight_utc():
    assert coach_service.kst_today(datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc)) == date(2026, 10, 13)
    assert coach_service.kst_today(datetime(2026, 10, 12, 14, 59, tzinfo=timezone.utc)) == date(2026, 10, 12)


# ---------------------------------------------------------------- coach router
import httpx

from shared.auth import get_current_user
from shared.database import get_db
from apps.trading_game.main import app
from apps.trading_game.services import connection_manager


@pytest.fixture
async def api(maker):
    """(client, set_user) — get_db 는 테스트 엔진, 인증 유저는 set_user 로 교체."""
    state: dict = {}

    async def _db():
        async with maker() as s:
            yield s

    async def _user():
        return state["user"]

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, (lambda u: state.__setitem__("user", u))
    app.dependency_overrides.clear()


def _body(season_id, action="draft", **over):
    b = {
        "season_id": season_id, "target_date": "2026-10-13", "coach_type": "MORNING",
        "title": "모닝 브리핑", "summary_nudge": "반도체 강세", "content_md": "## 시황",
        "support_price": 70000, "resistance_price": 75000, "action": action,
    }
    b.update(over)
    return b


async def test_router_admin_upsert_flow_and_broadcast(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        admin = await _seed_admin(db)
    set_user(admin)
    sent = []

    async def fake_broadcast(payload):
        sent.append(payload)

    monkeypatch.setattr(connection_manager.manager, "broadcast", fake_broadcast)

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id))
    assert r.status_code == 200 and r.json()["status"] == "DRAFT"
    assert sent == []  # 초안은 push 없음

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"
    assert len(sent) == 1 and sent[0]["type"] == "coach"

    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id))
    assert r.status_code == 409

    r = await client.get("/api/game/admin/coach-messages",
                         params={"season_id": season.id, "target_date": "2026-10-13"})
    assert r.status_code == 200 and len(r.json()) == 1

    r = await client.get("/api/game/admin/seasons")
    assert r.status_code == 200 and r.json()[0]["ticker"] == "005930"


async def test_router_publish_succeeds_even_if_broadcast_fails(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_admin(db))

    async def boom(payload):
        raise RuntimeError("ws down")

    monkeypatch.setattr(connection_manager.manager, "broadcast", boom)
    r = await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    assert r.status_code == 200 and r.json()["status"] == "PUBLISHED"


async def test_router_non_admin_forbidden_and_validation(api, maker):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        player = User(nickname="플레이어", role=UserRole.FREE, is_active=True)
        db.add(player)
        await db.commit()
        await db.refresh(player)
        admin = await _seed_admin(db)
    set_user(player)
    assert (await client.put("/api/game/admin/coach-messages", json=_body(season.id))).status_code == 403
    assert (await client.get("/api/game/admin/seasons")).status_code == 403
    assert (await client.get("/api/game/admin/coach-messages",
                             params={"season_id": season.id, "target_date": "2026-10-13"})).status_code == 403

    set_user(admin)
    bad = _body(season.id, support_price=80000, resistance_price=75000)
    assert (await client.put("/api/game/admin/coach-messages", json=bad)).status_code == 422
    assert (await client.put("/api/game/admin/coach-messages", json=_body(999))).status_code == 404
    bad_type = _body(season.id, coach_type="IN_PLAY")
    assert (await client.put("/api/game/admin/coach-messages", json=bad_type)).status_code == 422


async def test_router_coach_today(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        admin = await _seed_admin(db)
    set_user(admin)
    monkeypatch.setattr(coach_service, "kst_today", lambda: date(2026, 10, 13))

    async def noop(payload):
        return None

    monkeypatch.setattr(connection_manager.manager, "broadcast", noop)

    r = await client.get("/api/game/coach/today")
    assert r.status_code == 200
    assert r.json() == {"target_date": "2026-10-13", "season_id": season.id,
                        "morning": None, "evening": None, "active": None}

    await client.put("/api/game/admin/coach-messages", json=_body(season.id, action="publish"))
    data = (await client.get("/api/game/coach/today")).json()
    assert data["morning"]["title"] == "모닝 브리핑"
    assert data["active"]["coach_type"] == "MORNING"

    await client.put("/api/game/admin/coach-messages",
                     json=_body(season.id, action="publish", coach_type="EVENING", title="이브닝"))
    data = (await client.get("/api/game/coach/today")).json()
    assert data["active"]["coach_type"] == "EVENING"


async def test_router_coach_today_without_active_season(api, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        await _seed_season(db, status="FINISHED")
        admin = await _seed_admin(db)
    set_user(admin)
    monkeypatch.setattr(coach_service, "kst_today", lambda: date(2026, 10, 13))
    r = await client.get("/api/game/coach/today")
    assert r.status_code == 200
    data = r.json()
    assert data["season_id"] is None and data["morning"] is None
    assert data["evening"] is None and data["active"] is None

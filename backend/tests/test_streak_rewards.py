"""연속 출석 마일스톤 보상(백로그 ⑤-1) — 모델·서비스·라우터 테스트."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from shared.game_models import StreakRewardClaim
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_season, _seed_user, api, fake_redis, maker, session,
)


# ---------------------------------------------------------------- model
async def test_streak_reward_claim_roundtrip_and_unique(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    row = StreakRewardClaim(user_id=user.id, season_id=season.id, milestone=3, amount=Decimal("100000"))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    assert row.id is not None and row.claimed_at is not None
    assert row.amount == Decimal("100000")

    session.add(StreakRewardClaim(user_id=user.id, season_id=season.id, milestone=3, amount=Decimal("100000")))
    with pytest.raises(IntegrityError):
        await session.commit()


# ---------------------------------------------------------------- service
from fakeredis import aioredis as fake_aioredis

from shared.game_models import GameAccount, GameSeason, UserStreak
from apps.trading_game.services import feature_flag_service, order_engine, streak_reward_service as srs

T = date(2026, 10, 13)  # 테스트 기준 '오늘'(KST)


def _redis():
    return fake_aioredis.FakeRedis(decode_responses=True)


async def _seed_streak(db, user, current: int, last: date | None) -> UserStreak:
    row = UserStreak(user_id=user.id, current_streak=current, highest_streak=current, last_activity_date=last)
    db.add(row)
    await db.commit()
    return row


async def _claims(db, user_id: int) -> list[tuple[int, int]]:
    rows = (
        await db.execute(
            select(StreakRewardClaim).where(StreakRewardClaim.user_id == user_id).order_by(StreakRewardClaim.id)
        )
    ).scalars().all()
    return [(r.season_id, r.milestone) for r in rows]


def test_milestones_constant():
    assert srs.STREAK_MILESTONES == (
        (3, Decimal("100000")), (7, Decimal("300000")), (14, Decimal("700000")), (30, Decimal("2000000")),
    )


@pytest.mark.parametrize("current, last, milestone, expected", [
    (3, T, 3, True),                          # 오늘 활동 · 경계 정확히
    (3, T - timedelta(days=1), 3, True),      # 어제 활동 — 연속 살아 있음
    (3, T - timedelta(days=2), 3, False),     # 그제 활동 — 끊김(current 가 남아 있어도)
    (2, T, 3, False),                         # 경계 미달
    (7, T, 3, True),
    (7, T, 7, True),
    (13, T, 14, False),
    (30, T, 30, True),
    (5, None, 3, False),
])
def test_is_eligible(current, last, milestone, expected):
    row = UserStreak(user_id=1, current_streak=current, highest_streak=99, last_activity_date=last)
    assert srs.is_eligible(row, milestone, T) is expected


def test_is_eligible_without_row():
    assert srs.is_eligible(None, 3, T) is False


def test_is_eligible_ignores_highest_streak():
    row = UserStreak(user_id=1, current_streak=1, highest_streak=30, last_activity_date=T)
    assert srs.is_eligible(row, 3, T) is False


async def test_reward_status_claimed_and_claimable(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    await _seed_streak(session, user, 7, T)
    session.add(StreakRewardClaim(user_id=user.id, season_id=season.id, milestone=3, amount=Decimal("100000")))
    await session.commit()
    rewards = await srs.reward_status(session, _redis(), user.id, today=T)
    assert [(r.milestone, r.amount, r.claimed, r.claimable) for r in rewards] == [
        (3, Decimal("100000"), True, False),
        (7, Decimal("300000"), False, True),
        (14, Decimal("700000"), False, False),
        (30, Decimal("2000000"), False, False),
    ]


async def test_reward_status_empty_when_flag_off_or_no_season(session):
    redis = _redis()
    user = await _seed_user(session)
    await _seed_streak(session, user, 7, T)
    assert await srs.reward_status(session, redis, user.id, today=T) == []  # 시즌 없음
    await _seed_season(session)
    assert len(await srs.reward_status(session, redis, user.id, today=T)) == 4
    await feature_flag_service.set_flag(session, redis, "STREAK", False)
    assert await srs.reward_status(session, redis, user.id, today=T) == []


async def test_reward_status_without_streak_row(session):
    user = await _seed_user(session)
    await _seed_season(session)
    rewards = await srs.reward_status(session, _redis(), user.id, today=T)
    assert [(r.claimed, r.claimable) for r in rewards] == [(False, False)] * 4


async def test_claim_success_grants_cash(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    await _seed_streak(session, user, 7, T - timedelta(days=1))
    acc = await srs.claim(session, _redis(), user.id, 7, today=T)
    assert acc.season_id == season.id
    assert acc.cash_balance == Decimal("10300000")
    assert acc.bonus_cash == Decimal("300000.00")  # ROI 0% → 같은 금액
    assert await _claims(session, user.id) == [(season.id, 7)]
    row = (await session.execute(select(StreakRewardClaim))).scalar_one()
    assert row.amount == Decimal("300000")


async def test_claim_not_reached_and_broken_streak(session):
    user = await _seed_user(session)
    await _seed_season(session)
    await _seed_streak(session, user, 6, T)
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), user.id, 7, today=T)
    assert e.value.code == "NOT_REACHED"
    with pytest.raises(srs.StreakRewardError) as e:  # 그제 활동 — 끊긴 연속
        await srs.claim(session, _redis(), user.id, 3, today=T + timedelta(days=2))
    assert e.value.code == "NOT_REACHED"
    assert await _claims(session, user.id) == []


async def test_claim_twice_already_claimed(session):
    user = await _seed_user(session)
    await _seed_season(session)
    await _seed_streak(session, user, 3, T)
    await srs.claim(session, _redis(), user.id, 3, today=T)
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), user.id, 3, today=T)
    assert e.value.code == "ALREADY_CLAIMED"
    acc = (await session.execute(select(GameAccount).where(GameAccount.user_id == user.id))).scalar_one()
    assert acc.cash_balance == Decimal("10100000")  # 1회만 지급


async def test_claim_unique_violation_maps_to_already_claimed(maker, monkeypatch):
    # 선조회를 통과한 동시 요청(레이스) — 유니크 위반 → ALREADY_CLAIMED, 지급 없음
    async with maker() as setup:
        user = await _seed_user(setup)
        season = await _seed_season(setup)
        await _seed_streak(setup, user, 3, T)
        await srs.claim(setup, _redis(), user.id, 3, today=T)
        uid, sid = user.id, season.id

    async def _never_claimed(*_a, **_k):
        return False

    monkeypatch.setattr(srs, "_already_claimed", _never_claimed)
    async with maker() as db:
        with pytest.raises(srs.StreakRewardError) as e:
            await srs.claim(db, _redis(), uid, 3, today=T)
        assert e.value.code == "ALREADY_CLAIMED"
    async with maker() as db:
        acc = (await db.execute(select(GameAccount).where(GameAccount.user_id == uid))).scalar_one()
        assert acc.cash_balance == Decimal("10100000")
        assert await _claims(db, uid) == [(sid, 3)]


async def test_claim_per_season_independent(session):
    user = await _seed_user(session)
    s1 = await _seed_season(session)
    await _seed_streak(session, user, 3, T)
    await srs.claim(session, _redis(), user.id, 3, today=T)
    s1.status = "FINISHED"
    s2 = GameSeason(
        season_number=2, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 12, 0, 0, tzinfo=timezone.utc), status="ACTIVE",
    )
    session.add(s2)
    await session.commit()
    acc2 = await srs.claim(session, _redis(), user.id, 3, today=T)
    assert acc2.season_id == s2.id and acc2.cash_balance == Decimal("10100000")
    assert await _claims(session, user.id) == [(s1.id, 3), (s2.id, 3)]


async def test_claim_no_active_season(session):
    user = await _seed_user(session)
    await _seed_streak(session, user, 3, T)
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), user.id, 3, today=T)
    assert e.value.code == "NO_ACTIVE_SEASON"

    season = await _seed_season(session)
    season.end_at = datetime.now(timezone.utc) - timedelta(minutes=1)  # ACTIVE 지만 정산 대기
    await session.commit()
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), user.id, 3, today=T)
    assert e.value.code == "NO_ACTIVE_SEASON"
    assert await _claims(session, user.id) == []


async def test_claim_price_unavailable_rolls_back_claim_row(session):
    user = await _seed_user(session)
    season = await _seed_season(session)
    acc = GameAccount(user_id=user.id, season_id=season.id)
    session.add(acc)
    await session.commit()
    await order_engine.open_position(
        session, account=acc, side="LONG", ratio=Decimal("0.5"), leverage=1,
        entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
    )
    await _seed_streak(session, user, 3, T)
    cash_before, acc_id, uid = acc.cash_balance, acc.id, user.id  # rollback 후 expire 대비
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), uid, 3, today=T)  # 최신가 없음
    assert e.value.code == "PRICE_UNAVAILABLE"
    assert await _claims(session, uid) == []
    fresh = await session.get(GameAccount, acc_id, populate_existing=True)
    assert fresh.cash_balance == cash_before and fresh.bonus_cash == Decimal("0")


async def test_claim_unknown_milestone(session):
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _redis(), 1, 5, today=T)
    assert e.value.code == "UNKNOWN_MILESTONE"


async def test_claim_feature_disabled(session):
    redis = _redis()
    user = await _seed_user(session)
    await _seed_season(session)
    await _seed_streak(session, user, 3, T)
    await feature_flag_service.set_flag(session, redis, "STREAK", False)
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, redis, user.id, 3, today=T)
    assert e.value.code == "FEATURE_DISABLED"
    assert await _claims(session, user.id) == []


# ---------------------------------------------------------------- router
from apps.trading_game.services import coach_service
from tests.test_quest_quiz_streak import _seed_quizzes


def _today() -> date:
    return coach_service.kst_today()


async def test_router_streak_my_includes_rewards(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_season(db)
        await _seed_streak(db, user, 7, _today())
    set_user(user)
    r = await client.get("/api/game/streak/my")
    assert r.status_code == 200
    body = r.json()
    # 기존 필드 불변 + rewards 추가
    assert {k: body[k] for k in ("current_streak", "highest_streak", "last_activity_date", "enabled")} == {
        "current_streak": 7, "highest_streak": 7, "last_activity_date": _today().isoformat(), "enabled": True,
    }
    assert body["rewards"] == [
        {"milestone": 3, "amount": 100000, "claimed": False, "claimable": True},
        {"milestone": 7, "amount": 300000, "claimed": False, "claimable": True},
        {"milestone": 14, "amount": 700000, "claimed": False, "claimable": False},
        {"milestone": 30, "amount": 2000000, "claimed": False, "claimable": False},
    ]


async def test_router_streak_my_rewards_empty_without_season(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
    set_user(user)
    r = await client.get("/api/game/streak/my")
    assert r.json() == {
        "current_streak": 0, "highest_streak": 0, "last_activity_date": None, "enabled": True, "rewards": [],
    }


async def test_router_claim_flow(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_season(db)
        await _seed_streak(db, user, 7, _today() - timedelta(days=1))
    set_user(user)
    r = await client.post("/api/game/streak/rewards/7/claim")
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["cash_balance"]) == Decimal("10300000")
    assert body["streak"]["current_streak"] == 7 and body["streak"]["enabled"] is True
    assert [(x["milestone"], x["claimed"], x["claimable"]) for x in body["streak"]["rewards"]] == [
        (3, False, True), (7, True, False), (14, False, False), (30, False, False),
    ]

    r = await client.post("/api/game/streak/rewards/7/claim")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ALREADY_CLAIMED"
    r = await client.post("/api/game/streak/rewards/14/claim")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NOT_REACHED"
    r = await client.post("/api/game/streak/rewards/5/claim")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "UNKNOWN_MILESTONE"
    assert (await client.post("/api/game/streak/rewards/abc/claim")).status_code == 422


async def test_router_claim_no_season_and_disabled(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_streak(db, user, 3, _today())
    set_user(user)
    r = await client.post("/api/game/streak/rewards/3/claim")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "NO_ACTIVE_SEASON"

    async with maker() as db:
        await _seed_season(db)
        await feature_flag_service.set_flag(db, fake_redis, "STREAK", False)
    r = await client.post("/api/game/streak/rewards/3/claim")
    assert r.status_code == 503 and r.json()["detail"]["code"] == "FEATURE_DISABLED"
    r = await client.get("/api/game/streak/my")
    assert r.json()["enabled"] is False and r.json()["rewards"] == []


async def test_router_claim_price_unavailable(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        season = await _seed_season(db)
        acc = GameAccount(user_id=user.id, season_id=season.id)
        db.add(acc)
        await db.commit()
        await order_engine.open_position(
            db, account=acc, side="LONG", ratio=Decimal("0.5"), leverage=1,
            entry_price=Decimal("100"), sl_pct=None, tp_pct=None,
        )
        await _seed_streak(db, user, 3, _today())
    set_user(user)
    r = await client.post("/api/game/streak/rewards/3/claim")  # fake_redis 에 최신가 없음
    assert r.status_code == 409 and r.json()["detail"]["code"] == "PRICE_UNAVAILABLE"
    async with maker() as db:
        assert await _claims(db, user.id) == []


async def test_router_quiz_submit_streak_includes_rewards(api, maker, fake_redis):
    client, set_user = api
    async with maker() as db:
        user = await _seed_user(db)
        await _seed_season(db)
        await _seed_quizzes(db, 1)
        await _seed_streak(db, user, 2, _today() - timedelta(days=1))
    set_user(user)
    quiz = (await client.get("/api/game/quiz/random")).json()
    r = await client.post(f"/api/game/quiz/{quiz['id']}/submit", json={"choice": "UP"})
    assert r.status_code == 200, r.text
    streak = r.json()["streak"]
    assert streak["current_streak"] == 3
    assert streak["rewards"][0] == {"milestone": 3, "amount": 100000, "claimed": False, "claimable": True}

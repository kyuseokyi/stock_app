"""시즌 기간(month/quarter)·게임 설정·월간 랭킹 테스트."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from shared.game_models import GameSeason, GameSetting, WeeklyRankingResult
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_account, _seed_season, _seed_user, api, fake_redis, maker, session,
)

KST = timezone(timedelta(hours=9))
UTC = timezone.utc


# ---------------------------------------------------------------- 모델
async def test_season_period_defaults_to_month(session):
    s = await _seed_season(session)
    await session.refresh(s)
    assert s.period == "month"


async def test_game_setting_roundtrip_json(session):
    session.add(GameSetting(key="weekly_rewards", value=[1, 2, 3]))
    session.add(GameSetting(key="streak_rewards", value={"3": 1}))
    await session.commit()
    row = await session.get(GameSetting, "streak_rewards")
    assert row.value == {"3": 1}


async def test_result_period_type_default_and_unique_per_period(session):
    u = await _seed_user(session)
    s = await _seed_season(session)
    d = date(2027, 3, 1)
    session.add(WeeklyRankingResult(season_id=s.id, week_start=d, rank=1, user_id=u.id,
                                    weekly_roi=Decimal("1"), reward_amount=Decimal("0")))
    session.add(WeeklyRankingResult(season_id=s.id, week_start=d, rank=1, user_id=u.id, period_type="month",
                                    weekly_roi=Decimal("2"), reward_amount=Decimal("0")))
    await session.commit()  # 같은 날짜라도 주간·월간은 별개
    types = sorted((await session.execute(select(WeeklyRankingResult.period_type))).scalars())
    assert types == ["month", "week"]
    session.add(WeeklyRankingResult(season_id=s.id, week_start=d, rank=1, user_id=u.id, period_type="month",
                                    weekly_roi=Decimal("3"), reward_amount=Decimal("0")))
    with pytest.raises(IntegrityError):
        await session.commit()


# ---------------------------------------------------------------- 설정 서비스
from shared.models import UserRole  # noqa: E402
from apps.trading_game.services import game_settings_service as gss  # noqa: E402

DEFAULTS = {
    "next_season_period": "month",
    "weekly_rewards": [500000, 300000, 200000],
    "monthly_rewards": [1500000, 900000, 600000],
    "streak_rewards": {"3": 100000, "7": 300000, "14": 700000, "30": 2000000},
}


async def test_settings_defaults_when_no_rows(session):
    assert await gss.get_settings(session) == DEFAULTS


async def test_settings_update_merges_over_defaults(session):
    out = await gss.update_settings(session, {"next_season_period": "quarter", "weekly_rewards": [3, 2, 1]})
    assert out == {**DEFAULTS, "next_season_period": "quarter", "weekly_rewards": [3, 2, 1]}
    assert await gss.get_settings(session) == out
    out2 = await gss.update_settings(session, {"streak_rewards": {"3": 0, "7": 1, "14": 2, "30": 100_000_000}})
    assert out2["weekly_rewards"] == [3, 2, 1]
    assert out2["streak_rewards"] == {"3": 0, "7": 1, "14": 2, "30": 100_000_000}


@pytest.mark.parametrize("patch", [
    {"next_season_period": "year"},
    {"weekly_rewards": [1, 2]},
    {"weekly_rewards": [1, 2, 3, 4]},
    {"monthly_rewards": [1, 2, -1]},
    {"monthly_rewards": [1, 2, 100_000_001]},
    {"weekly_rewards": [1, 2, 1.5]},
    {"weekly_rewards": [1, 2, True]},
    {"weekly_rewards": "1,2,3"},
    {"streak_rewards": {"3": 1, "7": 1, "14": 1}},
    {"streak_rewards": {"3": 1, "7": 1, "14": 1, "30": 1, "60": 1}},
    {"streak_rewards": {"3": "1", "7": 1, "14": 1, "30": 1}},
    {"unknown_key": 1},
    {},
])
async def test_settings_validation_rejects(session, patch):
    with pytest.raises(gss.InvalidSettings):
        await gss.update_settings(session, patch)
    assert await gss.get_settings(session) == DEFAULTS


async def test_settings_helpers_return_decimal(session):
    await gss.update_settings(session, {"weekly_rewards": [30, 20, 10], "monthly_rewards": [3, 2, 1]})
    assert await gss.weekly_rewards(session) == {1: Decimal("30"), 2: Decimal("20"), 3: Decimal("10")}
    assert await gss.monthly_rewards(session) == {1: Decimal("3"), 2: Decimal("2"), 3: Decimal("1")}
    assert await gss.streak_rewards(session) == {3: Decimal("100000"), 7: Decimal("300000"),
                                                  14: Decimal("700000"), 30: Decimal("2000000")}
    assert await gss.next_season_period(session) == "month"


async def test_admin_settings_api_and_reward_config(api, fake_redis, maker):
    client, set_user = api
    async with maker() as db:
        admin = await _seed_user(db, role=UserRole.ADMIN, nickname="관리자")
        player = await _seed_user(db, nickname="플레이어")
    set_user(player)
    assert (await client.get("/api/game/admin/settings")).status_code == 403
    assert (await client.put("/api/game/admin/settings", json={"weekly_rewards": [1, 2, 3]})).status_code == 403
    set_user(admin)
    assert (await client.get("/api/game/admin/settings")).json() == DEFAULTS
    res = await client.put("/api/game/admin/settings", json={"next_season_period": "quarter",
                                                             "monthly_rewards": [9, 8, 7]})
    assert res.status_code == 200
    assert res.json() == {**DEFAULTS, "next_season_period": "quarter", "monthly_rewards": [9, 8, 7]}
    bad = await client.put("/api/game/admin/settings", json={"next_season_period": "year"})
    assert bad.status_code == 422
    assert (await client.put("/api/game/admin/settings", json=[1])).status_code == 422
    set_user(player)
    cfg = (await client.get("/api/game/reward-config")).json()
    assert cfg == {"weekly": [500000, 300000, 200000], "monthly": [9, 8, 7],
                   "streak": {"3": 100000, "7": 300000, "14": 700000, "30": 2000000}}

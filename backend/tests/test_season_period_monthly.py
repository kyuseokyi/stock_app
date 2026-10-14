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

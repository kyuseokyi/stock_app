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

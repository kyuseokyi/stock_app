"""게임 운영 설정 — 다음 시즌 기간·주간/월간/연속 출석 보상 금액·차트 기본 단위(admin 변경).

행이 없는 키는 기본값. 기본값은 기존 상수(weekly_ranking.REWARDS, STREAK_MILESTONES)에서 만든다.
변경은 다음 마감·다음 수령부터 적용(이미 지급된 기록의 reward_amount 는 그대로).
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameSetting
from apps.trading_game.services import weekly_ranking

PERIODS = ("month", "quarter")
MAX_AMOUNT = 100_000_000
MONTHLY_REWARDS_DEFAULT = (1_500_000, 900_000, 600_000)
# 차트 단위 — day=일봉(기존), 나머지는 game_minute_bars 분봉
CHART_INTERVALS = ("day", "1m", "5m", "15m", "60m")
KEYS = ("next_season_period", "weekly_rewards", "monthly_rewards", "streak_rewards", "chart_interval_default")


class InvalidSettings(ValueError):
    """잘못된 설정 값 — 라우터는 422."""


def defaults() -> dict:
    # streak_reward_service 가 이 모듈을 import 하므로 순환 방지용 지연 import
    from apps.trading_game.services.streak_reward_service import STREAK_MILESTONES
    return {
        "next_season_period": "month",
        "weekly_rewards": [int(weekly_ranking.REWARDS[r]) for r in (1, 2, 3)],
        "monthly_rewards": list(MONTHLY_REWARDS_DEFAULT),
        "streak_rewards": {str(m): int(a) for m, a in STREAK_MILESTONES},
        "chart_interval_default": "day",
    }


async def get_settings(db: AsyncSession) -> dict:
    """기본값 위에 DB 행을 덮어 반환."""
    out = defaults()
    rows = (await db.execute(select(GameSetting).where(GameSetting.key.in_(KEYS)))).scalars().all()
    for r in rows:
        out[r.key] = r.value
    return out


def _amount(v, where: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_AMOUNT:
        raise InvalidSettings(f"{where}: 0~{MAX_AMOUNT:,} 사이 정수여야 합니다.")
    return v


def _validate(patch) -> dict:
    if not isinstance(patch, dict) or not patch:
        raise InvalidSettings("변경할 설정이 없습니다.")
    unknown = set(patch) - set(KEYS)
    if unknown:
        raise InvalidSettings(f"알 수 없는 설정: {', '.join(sorted(unknown))}")
    out: dict = {}
    for key, v in patch.items():
        if key == "next_season_period":
            if v not in PERIODS:
                raise InvalidSettings("next_season_period: month 또는 quarter 여야 합니다.")
            out[key] = v
        elif key == "chart_interval_default":
            if v not in CHART_INTERVALS:
                raise InvalidSettings(f"chart_interval_default: {'|'.join(CHART_INTERVALS)} 중 하나여야 합니다.")
            out[key] = v
        elif key in ("weekly_rewards", "monthly_rewards"):
            if not isinstance(v, list) or len(v) != 3:
                raise InvalidSettings(f"{key}: 1~3위 금액 3개여야 합니다.")
            out[key] = [_amount(x, key) for x in v]
        else:  # streak_rewards — 마일스톤 집합은 고정, 금액만
            expected = set(defaults()["streak_rewards"])
            if not isinstance(v, dict) or set(v) != expected:
                raise InvalidSettings(f"streak_rewards: 키는 {sorted(expected, key=int)} 이어야 합니다.")
            out[key] = {k: _amount(v[k], f"streak_rewards[{k}]") for k in sorted(v, key=int)}
    return out


async def update_settings(db: AsyncSession, patch) -> dict:
    """검증 후 저장(부분 갱신). 잘못된 값이면 InvalidSettings(아무것도 저장하지 않음)."""
    clean = _validate(patch)
    now = datetime.now(timezone.utc)
    for key, value in clean.items():
        row = await db.get(GameSetting, key)
        if row is None:
            db.add(GameSetting(key=key, value=value, updated_at=now))
        else:
            row.value = value
            row.updated_at = now
    await db.commit()
    return await get_settings(db)


# ---------------------------------------------------------------- 지급 시점 조회
def _rank_map(values) -> dict[int, Decimal]:
    return {i: Decimal(str(a)) for i, a in enumerate(values, start=1)}


async def weekly_rewards(db: AsyncSession) -> dict[int, Decimal]:
    return _rank_map((await get_settings(db))["weekly_rewards"])


async def monthly_rewards(db: AsyncSession) -> dict[int, Decimal]:
    return _rank_map((await get_settings(db))["monthly_rewards"])


async def streak_rewards(db: AsyncSession) -> dict[int, Decimal]:
    return {int(m): Decimal(str(a)) for m, a in (await get_settings(db))["streak_rewards"].items()}


async def reward_config(db: AsyncSession) -> dict:
    """공개 보상 안내 — reward-config·규칙 API 공용."""
    s = await get_settings(db)
    return {"weekly": s["weekly_rewards"], "monthly": s["monthly_rewards"], "streak": s["streak_rewards"]}


async def chart_interval_default(db: AsyncSession) -> str:
    v = (await get_settings(db))["chart_interval_default"]
    return v if v in CHART_INTERVALS else "day"


async def next_season_period(db: AsyncSession) -> str:
    p = (await get_settings(db))["next_season_period"]
    return p if p in PERIODS else "month"

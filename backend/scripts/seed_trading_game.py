"""트레이딩 게임 개발 시드 (멱등).

시즌 1기(005930 삼성전자, 이번 달 1일 09:00 ~ 말일 20:00 KST — 정산의 차기 시즌 창과 같은 규칙) +
샘플 모닝 코치 메시지 1건. 재실행 시 season_number=1 존재하면 시즌은 건너뛰되, 종료일 없는(무기한)
ACTIVE 시즌이면 시작월 말일 20:00 으로 end_at 을 보정한다(월말 정산·자동 롤오버 대상이 되도록).
같은 시즌+오늘+MORNING 코치가 있으면 코치도 건너뛴다.

실행:
    cd backend
    uv run python -m scripts.seed_trading_game

주의: 운영 DB에는 실행하지 말 것. 로컬(stock_db)에서만 사용한다.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameCoachMessage, GameSeason
from apps.trading_game.services.settlement import month_bounds


KST = timezone(timedelta(hours=9))


async def seed_in(db, *, now: datetime | None = None) -> dict:
    """시드 본체(테스트 가능). 반환: {season_created, end_at_backfilled, coach_created}."""
    now = now or datetime.now(KST)
    season = (
        await db.execute(select(GameSeason).where(GameSeason.season_number == 1))
    ).scalar_one_or_none()
    created_season = False
    backfilled = False
    if season is None:
        start, end = month_bounds(now)
        season = GameSeason(
            season_number=1,
            ticker="005930",
            stock_name="삼성전자",
            start_at=start,
            end_at=end,
            period_type=None,
            status="ACTIVE",
        )
        db.add(season)
        await db.flush()          # season.id 확보
        created_season = True
    elif season.status == "ACTIVE" and season.end_at is None:
        _, end = month_bounds(season.start_at)
        season.end_at = end
        backfilled = True

    today = now.astimezone(KST).date()
    exists = (
        await db.execute(
            select(GameCoachMessage).where(
                GameCoachMessage.season_id == season.id,
                GameCoachMessage.target_date == today,
                GameCoachMessage.coach_type == "MORNING",
            )
        )
    ).scalar_one_or_none()
    created_coach = False
    if exists is None:
        db.add(
            GameCoachMessage(
                season_id=season.id,
                target_date=today,
                coach_type="MORNING",
                title="오늘의 모닝 브리핑",
                summary_nudge="71,000원 지지선 반등 여부를 주목하세요!",
                content_md=(
                    "## 오늘의 전략\n"
                    "71,000원 지지선과 73,500원 저항선 사이 흐름을 주시합니다."
                ),
                support_price=71000,
                resistance_price=73500,
                author_id=None,
                # Phase 5a: published_at 서버 기본값이 없어졌으므로 발행 상태·시각을 명시
                status="PUBLISHED",
                published_at=datetime.now(timezone.utc),
            )
        )
        created_coach = True

    await db.commit()
    return {"season_created": created_season, "end_at_backfilled": backfilled,
            "coach_created": created_coach}


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        r = await seed_in(db)
    print(
        f"[seed_trading_game] season(created={r['season_created']}, number=1, "
        f"end_at_backfilled={r['end_at_backfilled']}), coach(created={r['coach_created']})"
    )


if __name__ == "__main__":
    asyncio.run(seed())

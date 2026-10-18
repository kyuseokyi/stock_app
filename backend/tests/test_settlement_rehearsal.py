"""시즌 1기 정산 리허설 — 2026-10-31(토) 종료 시즌을 실제 일정 순서대로 재현.

beat(Asia/Seoul): 매일 20:40 정산, 매월 1일 08:55 월간 마감, 월 08:50 주간 마감.
시계는 settlement 모듈의 datetime 을 고정 시각으로 바꿔 흉내낸다(실서버·실DB 없음).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from shared.game_models import GamePosition, GameSeason, GameTrade, HallOfFame
from apps.collector.tasks import settle_season as ss
from apps.stock_api.services.chart import Candle
from apps.trading_game.services import monthly_ranking as mr
from apps.trading_game.services import monthly_service as ms_svc
from apps.trading_game.services import settlement
from apps.trading_game.services import weekly_ranking as wr
from apps.trading_game.services import weekly_service as ws_svc
from apps.trading_game.services import game_settings_service as gss
from apps.trading_game.services.ranking_service import ranking_key
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_account, _seed_user, maker, session,
)
from tests.test_season_period_monthly import _r, _rows, _season, kst

UTC = timezone.utc
LAST_WEEK = date(2026, 10, 26)  # 시즌 1 마지막 주(월)


def _freeze(monkeypatch, at: datetime) -> datetime:
    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return at.astimezone(tz) if tz else at.replace(tzinfo=None)

    monkeypatch.setattr(settlement, "datetime", _Frozen)
    return at


def _bar(d: str, close: float) -> Candle:
    return Candle(date=d, open=close, high=close, low=close, close=close, volume=1)


@pytest.fixture
def candles(monkeypatch):
    """정산 종가 소스(CH)를 대역으로 — 10/29 100, 10/30(금) 110. 10/31(토)·11/1(일)은 봉 없음."""
    monkeypatch.delenv("TRADING_DAYS", raising=False)
    monkeypatch.delenv("MARKET_HOLIDAYS", raising=False)
    state = {"candles": [_bar("2026-10-29", 100), _bar("2026-10-30", 110)], "rows": {}}
    monkeypatch.setattr(ss, "get_candles",
                        lambda t, s, e: [c for c in state["candles"] if s <= c.date <= e] or None)
    monkeypatch.setattr(ss, "_market_rows_on", lambda d: state["rows"].get(d, 0))
    return state


async def _open(db, acc, created_at):
    db.add(GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("100"),
                        size_amount=Decimal("1000000"), entry_ratio=Decimal("0.1"), leverage=1, status="OPEN",
                        created_at=created_at.astimezone(UTC)))
    await db.commit()


async def _players(db, season, r):
    """거래 3명(열린 포지션 진입가 100) + 퀴즈만 한 무거래 1명. 마지막 주 주간 ZSET·시즌 랭킹에 순위."""
    users = []
    for i in range(3):
        u = await _seed_user(db, nickname=f"p{i}")
        await _open(db, await _seed_account(db, u, season), kst(2026, 10, 27, 10))
        await r.zadd(wr.week_key(season.id, LAST_WEEK), {str(u.id): float(3 - i)})
        await r.zadd(ranking_key(season.id), {str(u.id): float(3 - i)})
        users.append(u)
    idle = await _seed_user(db, nickname="quiz_only")
    await _seed_account(db, idle, season, cash=Decimal("10200000"))
    return users, idle


async def _settle(db, r, monkeypatch, at):
    _freeze(monkeypatch, at)
    return await settlement.settle_due_season(db, r, lambda t, e: ss.clickhouse_close_price(t, e, now=at))


async def test_rehearsal_oct31_month_season(session, monkeypatch, candles):
    r = _r()
    s1 = await _season(session, start=kst(2026, 10, 1, 9), end=kst(2026, 10, 31, 20))
    users, idle = await _players(session, s1, r)

    # 금 20:40 — 아직 종료 전 / 토 19:59 — 종료 1분 전
    assert await _settle(session, r, monkeypatch, kst(2026, 10, 30, 20, 40)) is None
    assert await _settle(session, r, monkeypatch, kst(2026, 10, 31, 19, 59)) is None
    await session.refresh(s1)
    assert s1.status == "ACTIVE"

    # 토 20:40 — 정산: 금요일(10/30) 종가 110
    out = await _settle(session, r, monkeypatch, kst(2026, 10, 31, 20, 40))
    assert out == {"settled_season": 1, "closed": 3, "archived": 3, "next_season": 2}
    trades = (await session.execute(select(GameTrade))).scalars().all()
    assert {t.exit_price for t in trades} == {Decimal("110")}
    assert {t.closed_reason for t in trades} == {"SEASON_END"}
    assert (await session.execute(select(GamePosition).where(GamePosition.status == "OPEN"))).first() is None

    hof = (await session.execute(select(HallOfFame).order_by(HallOfFame.rank))).scalars().all()
    assert len(hof) == 3 and idle.id not in {h.user_id for h in hof}

    await session.refresh(s1)
    assert s1.status == "FINISHED"
    s2 = (await session.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert s2.status == "ACTIVE" and s2.ticker == s1.ticker and s2.period == "month"
    assert s2.start_at.astimezone(settlement.KST) == kst(2026, 11, 1, 9)
    assert s2.end_at.astimezone(settlement.KST) == kst(2026, 11, 30, 20)

    # 마지막 주(10/26 주) 기록만, 보상 없음 / 시즌 실시간 랭킹 키 삭제
    assert await _rows(session, "week") == [(1, users[0].id, Decimal("0.00")),
                                            (2, users[1].id, Decimal("0.00")),
                                            (3, users[2].id, Decimal("0.00"))]
    assert not await r.exists(ranking_key(s1.id))

    # 토 21:00 재실행 — 멱등(시즌 2 는 아직 종료 전)
    assert await _settle(session, r, monkeypatch, kst(2026, 10, 31, 21, 0)) is None
    assert len((await session.execute(select(GameSeason))).scalars().all()) == 2

    # 일 08:55 월간 마감 — 월간 시즌이라 없음
    assert await ms_svc.close_previous_month(session, r, now=kst(2026, 11, 1, 8, 55)) is None
    # 월 08:50 주간 마감 — 시즌 2 의 지난주 창(11/1 09:00~11/2 09:00)은 기록 없음, 시즌 1 중복·보상 없음
    out_w = await ws_svc.close_previous_week(session, r, now=kst(2026, 11, 2, 8, 50))
    assert out_w == {"week_start": "2026-10-26", "archived": 0, "rewarded": 0}
    assert len(await _rows(session, "week")) == 3


async def test_rehearsal_next_season_quarter_when_admin_selects(session, monkeypatch, candles):
    r = _r()
    s1 = await _season(session, start=kst(2026, 10, 1, 9), end=kst(2026, 10, 31, 20))
    await _players(session, s1, r)
    await gss.update_settings(session, {"next_season_period": "quarter"})
    await _settle(session, r, monkeypatch, kst(2026, 10, 31, 20, 40))
    s2 = (await session.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert s2.period == "quarter"
    assert s2.start_at.astimezone(settlement.KST) == kst(2026, 11, 1, 9)
    assert s2.end_at.astimezone(settlement.KST) == kst(2026, 12, 31, 20)  # 11월 시작 분기 = 11~12월


async def test_rehearsal_dec31_krx_closing_day_settles_same_night(session, monkeypatch, candles):
    """분기 시즌이 12/31(목, KRX 연말 휴장)에 끝남 — 거래일 달력으로 휴장을 알아 당일 20:40 에 12/30 종가로 정산."""
    r = _r()
    candles["candles"] = [_bar("2026-12-30", 120)]
    s = await _season(session, start=kst(2026, 11, 1, 9), end=kst(2026, 12, 31, 20), period="quarter")
    u = await _seed_user(session)
    await _open(session, await _seed_account(session, u, s), kst(2026, 12, 29, 10))
    await r.zadd(mr.month_key(s.id, date(2026, 12, 1)), {str(u.id): 4.0})

    out = await _settle(session, r, monkeypatch, kst(2026, 12, 31, 20, 40))
    assert out is not None and out["settled_season"] == 1
    assert (await session.execute(select(GameTrade))).scalar_one().exit_price == Decimal("120")
    # 12월(시즌 마지막 달) 월간 기록만, 보상 없음
    assert await _rows(session, "month") == [(1, u.id, Decimal("0.00"))]
    # 1/1 08:55 월간 마감 — 활성 시즌(1/1 09:00 시작)의 지난달 창이 없어 아무것도 안 함
    assert await ms_svc.close_previous_month(session, r, now=kst(2027, 1, 1, 8, 55)) is None

"""트레이딩 게임 Phase 4 — 랭킹/정산/MBTI 단위 테스트."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from apps.trading_game.services import mbti_analyzer


def _trade(side="LONG", pnl="100", ratio="0.5", had_sl=True, hold_sec=3600):
    """MBTI 분류 입력용 경량 스텁(실제 GameTrade 속성명과 동일)."""
    opened = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    closed = opened + timedelta(seconds=hold_sec)

    class _T:
        pass
    t = _T()
    t.side = side
    t.pnl_amount = Decimal(pnl)
    t.entry_ratio = Decimal(ratio)
    t.had_stop_loss = had_sl
    t.opened_at = opened
    t.closed_at = closed
    return t


def test_mbti_default_when_few_trades():
    assert mbti_analyzer.classify_mbti([_trade(), _trade()]) == "균형 탐색가"


def test_mbti_principled_stop_loss():
    trades = [_trade(ratio="0.25", had_sl=True, hold_sec=7200) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "냉철한 원칙주의자"


def test_mbti_reckless_allin_scalper():
    trades = [_trade(ratio="1.0", had_sl=True, hold_sec=60) for _ in range(5)]
    assert mbti_analyzer.classify_mbti(trades) == "불나방 트레이더"


def test_mbti_big_short():
    trades = [
        _trade(side="SHORT", pnl="300", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "빅쇼트의 후예"


def test_mbti_bull_sniper():
    trades = [
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="100", ratio="0.25", had_sl=False, hold_sec=7200),
        _trade(side="LONG", pnl="-50", ratio="0.25", had_sl=False, hold_sec=7200),
    ]
    assert mbti_analyzer.classify_mbti(trades) == "황소 저격수"


import pytest
from fakeredis import aioredis as fake_aioredis

from apps.trading_game.services import ranking_service


@pytest.fixture
async def redis():
    r = fake_aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()


def test_compute_live_roi_flat_cash():
    roi = ranking_service.compute_live_roi(
        Decimal("11000000"), None, Decimal("100"), Decimal("10000000")
    )
    assert roi == Decimal("10.0000")


def test_compute_live_roi_with_open_position():
    class _P:
        side = "LONG"
        entry_price = Decimal("100")
        size_amount = Decimal("5000000")
        leverage = 1
    roi = ranking_service.compute_live_roi(
        Decimal("5000000"), _P(), Decimal("110"), Decimal("10000000")
    )
    assert roi > Decimal("4")


async def test_update_and_my_rank(redis):
    await ranking_service.update_rank(redis, 1, 10, Decimal("5.5"))
    await ranking_service.update_rank(redis, 1, 20, Decimal("12.3"))
    await ranking_service.update_rank(redis, 1, 30, Decimal("-2.0"))
    mine = await ranking_service.my_rank(redis, 1, 20)
    assert mine["rank"] == 1
    assert mine["roi_pct"] == 12.3
    assert mine["total"] == 3
    none_rank = await ranking_service.my_rank(redis, 1, 999)
    assert none_rank["rank"] is None


from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.models import Base, User, UserRole
from shared.game_models import (
    GameAccount, GamePosition, GameSeason, HallOfFame, INITIAL_CASH,
)
from apps.trading_game.services import settlement


@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed_season_with_players(db, end_at):
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc), end_at=end_at, status="ACTIVE",
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    for i in range(3):
        u = User(nickname=f"p{i}", role=UserRole.FREE, is_active=True)
        db.add(u)
        await db.commit()
        await db.refresh(u)
        acc = GameAccount(user_id=u.id, season_id=season.id, cash_balance=Decimal("0"))
        db.add(acc)
        await db.commit()
        await db.refresh(acc)
        db.add(GamePosition(
            account_id=acc.id, side="LONG", entry_price=Decimal("100"),
            size_amount=INITIAL_CASH, entry_ratio=Decimal("1.0"), leverage=1, status="OPEN",
        ))
        await db.commit()
    return season


async def test_settlement_closes_archives_and_rolls_over(db):
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    season = await _seed_season_with_players(db, end_at=past)
    result = await settlement.settle_due_season(
        db, redis=None, close_price_provider=lambda t, e: Decimal("110")
    )
    assert result is not None
    opens = (await db.execute(select(GamePosition).where(GamePosition.status == "OPEN"))).scalars().all()
    assert opens == []
    hof = (await db.execute(select(HallOfFame).where(HallOfFame.season_id == season.id))).scalars().all()
    assert len(hof) == 3
    assert all(h.trading_mbti for h in hof)
    await db.refresh(season)
    assert season.status == "FINISHED"
    nxt = (await db.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert nxt.status == "ACTIVE" and nxt.ticker == "005930"


async def test_settlement_idempotent(db):
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    await _seed_season_with_players(db, end_at=past)
    await settlement.settle_due_season(db, None, lambda t, e: Decimal("110"))
    second = await settlement.settle_due_season(db, None, lambda t, e: Decimal("110"))
    assert second is None
    seasons = (await db.execute(select(GameSeason))).scalars().all()
    assert len(seasons) == 2


async def test_settlement_skips_open_ended(db):
    await _seed_season_with_players(db, end_at=None)
    assert await settlement.settle_due_season(db, None, lambda t, e: Decimal("110")) is None


def test_next_month_bounds_rollover_and_leap():
    from apps.trading_game.services.settlement import next_month_bounds, KST
    s, e = next_month_bounds(datetime(2026, 12, 31, 20, 0, tzinfo=KST))
    assert (s.year, s.month, s.day, s.hour) == (2027, 1, 1, 9)
    assert (e.year, e.month, e.day, e.hour) == (2027, 1, 31, 20)
    s2, e2 = next_month_bounds(datetime(2028, 1, 31, 20, 0, tzinfo=KST))
    assert (e2.month, e2.day) == (2, 29)  # 윤년 2028


async def test_settlement_hof_ordering_and_winrate(db):
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc), end_at=past, status="ACTIVE",
    )
    db.add(season); await db.commit(); await db.refresh(season)
    for i, entry in enumerate([Decimal("100"), Decimal("200")]):  # 승자/패자
        u = User(nickname=f"u{i}", role=UserRole.FREE, is_active=True)
        db.add(u); await db.commit(); await db.refresh(u)
        acc = GameAccount(user_id=u.id, season_id=season.id, cash_balance=Decimal("0"))
        db.add(acc); await db.commit(); await db.refresh(acc)
        db.add(GamePosition(
            account_id=acc.id, side="LONG", entry_price=entry,
            size_amount=INITIAL_CASH, entry_ratio=Decimal("1.0"), leverage=1, status="OPEN",
        ))
        await db.commit()
    await settlement.settle_due_season(db, None, lambda t, e: Decimal("110"))
    hof = (await db.execute(
        select(HallOfFame).where(HallOfFame.season_id == season.id).order_by(HallOfFame.rank)
    )).scalars().all()
    assert [h.rank for h in hof] == [1, 2]
    assert hof[0].final_roi > hof[1].final_roi
    assert hof[0].win_rate == Decimal("100.00")
    assert hof[1].win_rate == Decimal("0.00")


async def test_settlement_excludes_zero_trade_accounts(db):
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    season = await _seed_season_with_players(db, end_at=past)  # 3명: 정산 청산으로 거래 1회씩
    idle = User(nickname="quiz_only", role=UserRole.FREE, is_active=True)
    db.add(idle); await db.commit(); await db.refresh(idle)
    # 퀴즈·퀘스트 보상만 받은 무거래 계좌(ROI 0%) — 손실 계좌들보다 ROI 가 높아도 전당 제외
    db.add(GameAccount(user_id=idle.id, season_id=season.id, cash_balance=Decimal("10200000"),
                       total_asset=Decimal("10200000"), bonus_cash=Decimal("200000"), total_trades=0))
    await db.commit()
    await settlement.settle_due_season(db, None, lambda t, e: Decimal("90"))
    hof = (await db.execute(select(HallOfFame).where(HallOfFame.season_id == season.id))).scalars().all()
    assert len(hof) == 3
    assert idle.id not in {h.user_id for h in hof}


async def test_settlement_aborts_when_no_close_price(db):
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    season = await _seed_season_with_players(db, end_at=past)
    result = await settlement.settle_due_season(db, None, lambda t, e: None)
    assert result is None
    await db.refresh(season)
    assert season.status == "ACTIVE"  # 종가 없으면 정산 안 함, 시즌 유지


async def test_settlement_next_season_dates(db):
    from apps.trading_game.services.settlement import KST
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)  # 9월 말일 → 다음달=10월
    await _seed_season_with_players(db, end_at=past)
    await settlement.settle_due_season(db, None, lambda t, e: Decimal("110"))
    nxt = (await db.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    s = nxt.start_at.astimezone(KST); e = nxt.end_at.astimezone(KST)
    assert (s.month, s.day, s.hour) == (10, 1, 9)
    assert (e.month, e.day, e.hour) == (10, 31, 20)


async def test_settlement_mbti_from_real_trades(db):
    from shared.game_models import GameTrade
    past = datetime(2026, 9, 30, 11, 0, tzinfo=timezone.utc)
    season = GameSeason(
        season_number=1, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc), end_at=past, status="ACTIVE",
    )
    db.add(season); await db.commit(); await db.refresh(season)
    u = User(nickname="disciplined", role=UserRole.FREE, is_active=True)
    db.add(u); await db.commit(); await db.refresh(u)
    acc = GameAccount(user_id=u.id, season_id=season.id, cash_balance=INITIAL_CASH,
                      total_trades=3, win_trades=2)
    db.add(acc); await db.commit(); await db.refresh(acc)
    opened = datetime(2026, 9, 2, 9, 0, tzinfo=timezone.utc)
    for i in range(3):  # SL 설정 100% → 냉철한 원칙주의자
        db.add(GameTrade(
            account_id=acc.id, side="LONG", entry_price=Decimal("100"), exit_price=Decimal("105"),
            pnl_amount=Decimal("100"), roi_pct=Decimal("5"), closed_reason="MANUAL",
            size_amount=Decimal("2500000"), leverage=1, entry_ratio=Decimal("0.25"),
            opened_at=opened, had_stop_loss=True,
        ))
    await db.commit()
    await settlement.settle_due_season(db, None, lambda t, e: Decimal("110"))
    hof = (await db.execute(select(HallOfFame).where(HallOfFame.season_id == season.id))).scalars().all()
    assert len(hof) == 1
    assert hof[0].trading_mbti == "냉철한 원칙주의자"

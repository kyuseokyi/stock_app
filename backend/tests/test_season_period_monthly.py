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


# ---------------------------------------------------------------- 지급 금액 = 설정값
from fakeredis import aioredis as fake_aioredis  # noqa: E402

from shared.game_models import GamePosition, StreakRewardClaim, UserStreak  # noqa: E402
from apps.trading_game.services import streak_reward_service as srs  # noqa: E402
from apps.trading_game.services import weekly_ranking as wr  # noqa: E402
from apps.trading_game.services import weekly_service as ws_svc  # noqa: E402

S_START = datetime(2026, 10, 1, 9, 0, tzinfo=KST)
S_END = datetime(2026, 10, 31, 20, 0, tzinfo=KST)
W = date(2026, 10, 12)


def _r():
    return fake_aioredis.FakeRedis(decode_responses=True)


async def _season(db, start=S_START, end=S_END, period="month"):
    s = await _seed_season(db)
    s.start_at, s.end_at, s.period = start.astimezone(UTC), end.astimezone(UTC), period
    await db.commit()
    return s


async def _open_pos(db, acc, created_at):
    db.add(GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("70000"),
                        size_amount=Decimal("1000000"), leverage=1, status="CLOSED",
                        created_at=created_at.astimezone(UTC)))
    await db.commit()


async def _rows(db, period_type=None):
    q = select(WeeklyRankingResult).order_by(WeeklyRankingResult.period_type, WeeklyRankingResult.rank)
    if period_type:
        q = q.where(WeeklyRankingResult.period_type == period_type)
    return [(r.rank, r.user_id, r.reward_amount) for r in (await db.execute(q)).scalars().all()]


async def test_close_week_pays_configured_weekly_rewards(session):
    r = _r()
    s = await _season(session)
    await gss.update_settings(session, {"weekly_rewards": [7000, 0, 3000]})
    users = [await _seed_user(session, nickname=f"w{i}") for i in range(3)]
    accs = [await _seed_account(session, u, s) for u in users]
    for i, (u, a) in enumerate(zip(users, accs)):
        await r.zadd(wr.week_key(s.id, W), {str(u.id): float(10 - i)})
        await _open_pos(session, a, datetime(2026, 10, 13, 10, 0, tzinfo=KST))
    assert await ws_svc.close_week(session, r, s, W, with_reward=True) == {"archived": 3, "rewarded": 2}
    assert await _rows(session) == [(1, users[0].id, Decimal("7000.00")), (2, users[1].id, Decimal("0.00")),
                                    (3, users[2].id, Decimal("3000.00"))]
    await session.refresh(accs[0])
    assert accs[0].cash_balance == Decimal("10007000.00")


T = date(2026, 10, 13)


async def test_streak_status_and_claim_use_configured_amounts(session):
    user = await _seed_user(session)
    await _seed_season(session)
    session.add(UserStreak(user_id=user.id, current_streak=7, highest_streak=7, last_activity_date=T))
    await session.commit()
    await gss.update_settings(session, {"streak_rewards": {"3": 11, "7": 22, "14": 33, "30": 44}})
    st = await srs.reward_status(session, _r(), user.id, today=T)
    assert [(x.milestone, x.amount) for x in st] == [(3, Decimal("11")), (7, Decimal("22")),
                                                      (14, Decimal("33")), (30, Decimal("44"))]
    acc = await srs.claim(session, _r(), user.id, 7, today=T)
    assert acc.cash_balance == Decimal("10000022")
    row = (await session.execute(select(StreakRewardClaim))).scalar_one()
    assert row.amount == Decimal("22")
    with pytest.raises(srs.StreakRewardError) as e:
        await srs.claim(session, _r(), user.id, 5, today=T)
    assert e.value.code == "UNKNOWN_MILESTONE"


# ---------------------------------------------------------------- 시즌 기간
from apps.trading_game.services import settlement  # noqa: E402


def kst(y, m, d, h=0, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=KST)


@pytest.mark.parametrize("ref, period, start, end", [
    (kst(2026, 10, 15), "month", kst(2026, 10, 1, 9), kst(2026, 10, 31, 20)),
    (kst(2026, 10, 15), "quarter", kst(2026, 10, 1, 9), kst(2026, 12, 31, 20)),
    (kst(2026, 11, 1), "quarter", kst(2026, 11, 1, 9), kst(2026, 12, 31, 20)),   # 분기 중간 시작 → 분기 말까지
    (kst(2027, 1, 1), "quarter", kst(2027, 1, 1, 9), kst(2027, 3, 31, 20)),
    (kst(2027, 5, 3), "quarter", kst(2027, 5, 1, 9), kst(2027, 6, 30, 20)),
    (kst(2027, 9, 1), "quarter", kst(2027, 9, 1, 9), kst(2027, 9, 30, 20)),      # 분기 마지막 달 시작 → 그 달만
    (kst(2028, 2, 10), "month", kst(2028, 2, 1, 9), kst(2028, 2, 29, 20)),       # 윤년
])
def test_season_bounds(ref, period, start, end):
    assert settlement.season_bounds(ref, period) == (start, end)


@pytest.mark.parametrize("prev_end, period, start, end", [
    (kst(2026, 10, 31, 20), "month", kst(2026, 11, 1, 9), kst(2026, 11, 30, 20)),
    (kst(2026, 10, 31, 20), "quarter", kst(2026, 11, 1, 9), kst(2026, 12, 31, 20)),
    (kst(2026, 12, 31, 20), "quarter", kst(2027, 1, 1, 9), kst(2027, 3, 31, 20)),   # 12월 → 다음 해
    (kst(2026, 12, 31, 20), "month", kst(2027, 1, 1, 9), kst(2027, 1, 31, 20)),
    (kst(2026, 12, 31, 20).astimezone(UTC), "month", kst(2027, 1, 1, 9), kst(2027, 1, 31, 20)),  # UTC 입력
])
def test_next_season_bounds(prev_end, period, start, end):
    assert settlement.next_season_bounds(prev_end, period) == (start, end)


def test_season_bounds_rejects_unknown_period():
    with pytest.raises(ValueError):
        settlement.season_bounds(kst(2026, 10, 1), "year")


async def test_settlement_creates_next_season_with_configured_period(session):
    s = await _season(session, start=kst(2026, 9, 1, 9), end=kst(2026, 9, 30, 20))
    await gss.update_settings(session, {"next_season_period": "quarter"})
    out = await settlement.settle_due_season(session, None, lambda t, e: Decimal("70000"))
    assert out["next_season"] == 2
    nxt = (await session.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert nxt.period == "quarter"
    # SQLite 는 KST aware 값을 벽시계 그대로 naive 로 돌려준다
    assert (nxt.start_at.replace(tzinfo=None), nxt.end_at.replace(tzinfo=None)) == (
        datetime(2026, 10, 1, 9), datetime(2026, 12, 31, 20))
    assert s.period == "month"  # 진행 중(이번) 시즌 기간은 그대로


async def test_settlement_next_season_defaults_to_month(session):
    await _season(session, start=kst(2026, 9, 1, 9), end=kst(2026, 9, 30, 20))
    await settlement.settle_due_season(session, None, lambda t, e: Decimal("70000"))
    nxt = (await session.execute(select(GameSeason).where(GameSeason.season_number == 2))).scalar_one()
    assert nxt.period == "month" and nxt.end_at.replace(tzinfo=None) == datetime(2026, 10, 31, 20)


async def test_season_dtos_include_period(api, fake_redis, maker):
    client, set_user = api
    async with maker() as db:
        await _season(db, period="quarter")
        admin = await _seed_user(db, role=UserRole.ADMIN, nickname="관리자")
    body = (await client.get("/api/game/seasons/active")).json()
    assert body["period"] == "quarter" and body["season_number"] == 1
    set_user(admin)
    assert (await client.get("/api/game/admin/seasons")).json()[0]["period"] == "quarter"


# ---------------------------------------------------------------- 월간 랭킹 순수 로직·갱신
from apps.trading_game.services import monthly_ranking as mr  # noqa: E402
from apps.trading_game.services import ranking_service as rs  # noqa: E402

Q_START = kst(2026, 11, 1, 9)    # 분기 시즌(11월 중간 시작) 11/1~12/31
Q_END = kst(2026, 12, 31, 20)


@pytest.mark.parametrize("now, month_id, start, end", [
    (kst(2026, 11, 15, 12), date(2026, 11, 1), kst(2026, 11, 1, 9), kst(2026, 12, 1, 9)),
    (kst(2026, 12, 1, 9), date(2026, 12, 1), kst(2026, 12, 1, 9), Q_END),            # 1일 09:00 = 새 달, 끝은 시즌 종료로 잘림
    (kst(2026, 12, 1, 8, 59), date(2026, 11, 1), kst(2026, 11, 1, 9), kst(2026, 12, 1, 9)),  # 1일 08:59 = 지난달
    (kst(2027, 1, 1, 8), date(2026, 12, 1), kst(2026, 12, 1, 9), Q_END),              # 1월 1일 08시 = 12월
])
def test_month_bounds(now, month_id, start, end):
    assert mr.month_bounds(now, Q_START, Q_END) == (month_id, start, end)


def test_month_bounds_clipped_by_season_start_and_naive_utc():
    wid, s, e = mr.month_bounds(kst(2026, 11, 3), kst(2026, 11, 2, 9), None)
    assert (wid, s, e) == (date(2026, 11, 1), kst(2026, 11, 2, 9), kst(2026, 12, 1, 9))
    naive_start = datetime(2026, 11, 1, 0, 0)  # SQLite naive → UTC(=KST 09:00)
    assert mr.month_bounds(kst(2026, 11, 20), naive_start, None)[1] == kst(2026, 11, 1, 9)


def test_month_keys_and_ttl():
    assert mr.month_key(3, date(2026, 11, 1)) == "game:season:3:month:2026-11-01:ranking"
    assert mr.base_key(3, date(2026, 11, 1)) == "game:season:3:month:2026-11-01:base"
    assert mr.MONTH_TTL_SEC == 100 * 24 * 3600


QWIN = (Q_START, Q_END)
M11 = date(2026, 11, 1)


async def test_update_rank_quarter_updates_monthly_and_weekly():
    r = _r()
    await rs.update_rank(r, 1, 7, Decimal("10"), season_window=QWIN, period="quarter", now=kst(2026, 11, 3, 10))
    await rs.update_rank(r, 1, 7, Decimal("21"), season_window=QWIN, period="quarter", now=kst(2026, 11, 10, 10))
    assert await r.hget(mr.base_key(1, M11), "7") == "0.0"            # 이번 달 첫 갱신 전 시즌 점수 없음
    assert await r.zscore(mr.month_key(1, M11), "7") == pytest.approx(21.0)
    assert await r.hget(wr.base_key(1, date(2026, 11, 9)), "7") == "10.0"
    assert await r.zscore(wr.week_key(1, date(2026, 11, 9)), "7") == pytest.approx(10.0)
    assert await r.zscore(rs.ranking_key(1), "7") == pytest.approx(21.0)
    assert 0 < await r.ttl(mr.month_key(1, M11)) <= mr.MONTH_TTL_SEC
    assert 0 < await r.ttl(mr.base_key(1, M11)) <= mr.MONTH_TTL_SEC
    # 다음 달 첫 갱신 — 기준값은 갱신 전 시즌 점수(21)
    await rs.update_rank(r, 1, 7, Decimal("33.1"), season_window=QWIN, period="quarter", now=kst(2026, 12, 2, 10))
    assert await r.hget(mr.base_key(1, date(2026, 12, 1)), "7") == "21.0"
    assert await r.zscore(mr.month_key(1, date(2026, 12, 1)), "7") == pytest.approx(10.0)


async def test_update_rank_month_season_or_no_period_skips_monthly():
    r = _r()
    await rs.update_rank(r, 1, 7, Decimal("5"), season_window=QWIN, period="month", now=kst(2026, 11, 3, 10))
    await rs.update_rank(r, 1, 8, Decimal("5"), season_window=QWIN, now=kst(2026, 11, 3, 10))
    assert await r.keys("game:season:1:month:*") == []
    assert await r.zscore(wr.week_key(1, date(2026, 11, 2)), "7") == pytest.approx(5.0)
    assert await r.zscore(rs.ranking_key(1), "8") == pytest.approx(5.0)


async def test_sync_account_rank_passes_season_period(session):
    r = _r()
    now = datetime.now(UTC)
    s = await _season(session, start=now - timedelta(days=3), end=now + timedelta(days=30), period="quarter")
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s, roi=Decimal("4"))
    await rs.sync_account_rank(r, session, acc.id)
    assert len(await r.keys(f"game:season:{s.id}:month:*:ranking")) == 1


async def test_position_cache_snapshot_carries_period(maker):
    from apps.trading_game.services import position_cache
    async with maker() as db:
        s = await _season(db, period="quarter")
        u = await _seed_user(db)
        acc = await _seed_account(db, u, s)
        db.add(GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("1"),
                            size_amount=Decimal("1"), leverage=1, status="OPEN"))
        await db.commit()
    snap = await position_cache._load(maker)
    assert snap.season_periods == {s.id: "quarter"}
    assert len(snap.season_windows[s.id]) == 2


def test_account_deletion_patterns_cover_monthly_keys():
    import fnmatch
    from apps.auth.services import account_deletion
    assert fnmatch.fnmatchcase(mr.month_key(7, M11), account_deletion.MONTH_RANKING_PATTERN)
    assert fnmatch.fnmatchcase(mr.base_key(7, M11), account_deletion.MONTH_BASE_PATTERN)
    assert not fnmatch.fnmatchcase(rs.ranking_key(7), account_deletion.MONTH_RANKING_PATTERN)


async def test_account_deletion_removes_user_from_monthly_keys(session):
    from apps.auth.services import account_deletion
    r = _r()
    await r.zadd(mr.month_key(2, M11), {"5": 1.0, "6": 2.0})
    await r.hset(mr.base_key(2, M11), mapping={"5": "0", "6": "0"})
    await account_deletion._cleanup_rankings(r, 5, [2])
    assert await r.zscore(mr.month_key(2, M11), "5") is None
    assert await r.zscore(mr.month_key(2, M11), "6") == 2.0
    assert await r.hget(mr.base_key(2, M11), "5") is None


# ---------------------------------------------------------------- 월간 마감
from apps.trading_game.services import monthly_service as ms_svc  # noqa: E402


async def _q_season(db, start=Q_START, end=Q_END):
    return await _season(db, start=start, end=end, period="quarter")


async def test_close_month_archives_top10_rewards_eligible_with_monthly_amounts(session):
    r = _r()
    s = await _q_season(session)
    users = [await _seed_user(session, nickname=f"m{i}") for i in range(12)]
    accs = [await _seed_account(session, u, s) for u in users]
    for i, u in enumerate(users):
        await r.zadd(mr.month_key(s.id, M11), {str(u.id): float(100 - i)})
    await _open_pos(session, accs[0], kst(2026, 11, 20, 10))       # 1위: 그 달 주문 → 보상
    await _open_pos(session, accs[1], kst(2026, 12, 1, 9))         # 2위: 다음 달 1일 09:00(끝 정각) → 제외
    await _open_pos(session, accs[2], kst(2026, 11, 1, 9))         # 3위: 시작 정각 → 포함
    out = await ms_svc.close_month(session, r, s, M11, with_reward=True)
    assert out == {"archived": 10, "rewarded": 2}
    res = await _rows(session, "month")
    assert len(res) == 10
    assert res[:3] == [(1, users[0].id, Decimal("1500000.00")), (2, users[1].id, Decimal("0.00")),
                       (3, users[2].id, Decimal("600000.00"))]
    row = (await session.execute(select(WeeklyRankingResult).where(WeeklyRankingResult.rank == 1))).scalar_one()
    assert row.period_type == "month" and row.week_start == M11
    await session.refresh(accs[0])
    assert accs[0].cash_balance == Decimal("11500000.00")


async def test_close_month_uses_configured_monthly_rewards(session):
    r = _r()
    s = await _q_season(session)
    await gss.update_settings(session, {"monthly_rewards": [111, 22, 3]})
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, kst(2026, 11, 5, 10))
    await r.zadd(mr.month_key(s.id, M11), {str(u.id): 1.0})
    assert await ms_svc.close_month(session, r, s, M11, with_reward=True) == {"archived": 1, "rewarded": 1}
    assert await _rows(session, "month") == [(1, u.id, Decimal("111.00"))]


async def test_close_month_idempotent_and_skips_deleted_users(session):
    r = _r()
    s = await _q_season(session)
    users = [await _seed_user(session, nickname=f"x{i}") for i in range(2)]
    await r.zadd(mr.month_key(s.id, M11), {"99999": 500.0, str(users[0].id): 2.0, str(users[1].id): 1.0})
    assert await ms_svc.close_month(session, r, s, M11, with_reward=False) == {"archived": 2, "rewarded": 0}
    assert await ms_svc.close_month(session, r, s, M11, with_reward=True) == {"archived": 0, "rewarded": 0}
    assert await _rows(session, "month") == [(1, users[0].id, Decimal("0.00")), (2, users[1].id, Decimal("0.00"))]


async def test_close_month_empty(session):
    s = await _q_season(session)
    assert await ms_svc.close_month(session, _r(), s, M11, with_reward=True) == {"archived": 0, "rewarded": 0}


async def test_close_month_concurrent_integrity_error_rolls_back(session, monkeypatch):
    r = _r()
    s = await _q_season(session)
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, kst(2026, 11, 5, 10))
    await r.zadd(mr.month_key(s.id, M11), {str(u.id): 5.0})
    session.add(WeeklyRankingResult(season_id=s.id, period_type="month", week_start=M11, rank=1, user_id=u.id,
                                    weekly_roi=Decimal("5"), reward_amount=Decimal("0")))
    await session.commit()
    uid = u.id
    real_scalar = session.scalar
    calls = {"n": 0}

    async def racy_scalar(*a, **kw):
        calls["n"] += 1
        return 0 if calls["n"] == 1 else await real_scalar(*a, **kw)

    monkeypatch.setattr(session, "scalar", racy_scalar)
    assert await ms_svc.close_month(session, r, s, M11, with_reward=True) == {"archived": 0, "rewarded": 0}
    monkeypatch.undo()
    await session.refresh(acc)
    assert acc.cash_balance == Decimal("10000000.00")
    assert await _rows(session, "month") == [(1, uid, Decimal("0.00"))]


async def test_close_previous_month_quarter_only(session):
    r = _r()
    s = await _q_season(session)
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, kst(2026, 11, 5, 10))
    await r.zadd(mr.month_key(s.id, M11), {str(u.id): 5.0})
    out = await ms_svc.close_previous_month(session, r, now=kst(2026, 12, 1, 8, 55))
    assert out == {"month_start": "2026-11-01", "archived": 1, "rewarded": 1}
    s.period = "month"
    await session.commit()
    assert await ms_svc.close_previous_month(session, r, now=kst(2026, 12, 1, 8, 55)) is None


async def test_close_previous_month_skips_month_before_season(session):
    await _q_season(session)
    assert await ms_svc.close_previous_month(session, _r(), now=kst(2026, 11, 1, 8, 55)) is None  # 10월 = 시즌 전


async def test_close_previous_month_final_month_without_reward_when_settlement_delayed(session):
    r = _r()
    s = await _q_season(session)
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, kst(2026, 12, 5, 10))
    await r.zadd(mr.month_key(s.id, date(2026, 12, 1)), {str(u.id): 5.0})
    out = await ms_svc.close_previous_month(session, r, now=kst(2027, 1, 1, 8, 55))
    assert out == {"month_start": "2026-12-01", "archived": 1, "rewarded": 0}


async def test_settlement_records_final_month_for_quarter_season(session):
    r = _r()
    s = await _q_season(session, start=kst(2026, 7, 1, 9), end=kst(2026, 9, 30, 20))
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, kst(2026, 9, 5, 10))
    await r.zadd(mr.month_key(s.id, date(2026, 9, 1)), {str(u.id): 4.0})
    out = await settlement.settle_due_season(session, r, lambda t, e: Decimal("70000"))
    assert out["settled_season"] == 1
    assert await _rows(session, "month") == [(1, u.id, Decimal("0.00"))]


async def test_settlement_final_month_recorded_even_if_final_week_fails(session, monkeypatch):
    r = _r()
    s = await _q_season(session, start=kst(2026, 7, 1, 9), end=kst(2026, 9, 30, 20))
    u = await _seed_user(session)
    await r.zadd(mr.month_key(s.id, date(2026, 9, 1)), {str(u.id): 4.0})

    async def boom(*a, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(ws_svc, "close_week", boom)
    out = await settlement.settle_due_season(session, r, lambda t, e: Decimal("70000"))
    assert out["settled_season"] == 1
    assert await _rows(session, "month") == [(1, u.id, Decimal("0.00"))]


async def test_settlement_final_month_failure_does_not_block(session, monkeypatch, caplog):
    r = _r()
    s = await _q_season(session, start=kst(2026, 7, 1, 9), end=kst(2026, 9, 30, 20))
    sid = s.id  # 롤백이 ORM 객체를 만료시키므로 미리

    async def boom(*a, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(ms_svc, "close_month", boom)
    out = await settlement.settle_due_season(session, r, lambda t, e: Decimal("70000"))
    assert out is not None and out["next_season"] == 2
    msgs = [rec.getMessage() for rec in caplog.records if rec.name == "trading_game.settlement"]
    assert any(f"season={sid}" in m and "month_start=2026-09-01" in m for m in msgs)


async def test_settlement_month_season_does_not_record_monthly(session):
    r = _r()
    s = await _season(session, start=kst(2026, 9, 1, 9), end=kst(2026, 9, 30, 20))
    u = await _seed_user(session)
    await r.zadd(mr.month_key(s.id, date(2026, 9, 1)), {str(u.id): 4.0})
    await settlement.settle_due_season(session, r, lambda t, e: Decimal("70000"))
    assert await _rows(session, "month") == []


# ---------------------------------------------------------------- 주간 회귀(period_type 분리)
MON = date(2027, 3, 1)  # 월요일이자 3월 1일 — 주간 week_start 와 월간 month_id 가 같다


async def test_weekly_close_not_blocked_by_monthly_row_same_date(session):
    r = _r()
    s = await _q_season(session, start=kst(2027, 1, 1, 9), end=kst(2027, 3, 31, 20))
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    session.add(WeeklyRankingResult(season_id=s.id, period_type="month", week_start=MON, rank=1, user_id=u.id,
                                    weekly_roi=Decimal("9"), reward_amount=Decimal("0")))
    await session.commit()
    await _open_pos(session, acc, kst(2027, 3, 2, 10))
    await r.zadd(wr.week_key(s.id, MON), {str(u.id): 5.0})
    assert await ws_svc.close_week(session, r, s, MON, with_reward=True) == {"archived": 1, "rewarded": 1}
    assert await _rows(session, "week") == [(1, u.id, Decimal("500000.00"))]
    # 반대 방향 — 주간 행이 있어도 월간 마감은 진행
    await r.zadd(mr.month_key(s.id, date(2027, 2, 1)), {str(u.id): 1.0})
    session.add(WeeklyRankingResult(season_id=s.id, period_type="week", week_start=date(2027, 2, 1), rank=1,
                                    user_id=u.id, weekly_roi=Decimal("1"), reward_amount=Decimal("0")))
    await session.commit()
    out = await ms_svc.close_month(session, r, s, date(2027, 2, 1), with_reward=False)
    assert out == {"archived": 1, "rewarded": 0}


async def test_weekly_results_exclude_monthly_rows(session):
    s = await _q_season(session, start=kst(2027, 1, 1, 9), end=kst(2027, 3, 31, 20))
    u = await _seed_user(session, nickname="가")
    session.add_all([
        WeeklyRankingResult(season_id=s.id, period_type="month", week_start=MON, rank=1, user_id=u.id,
                            nickname="가", weekly_roi=Decimal("9"), reward_amount=Decimal("1500000")),
        WeeklyRankingResult(season_id=s.id, period_type="week", week_start=MON, rank=1, user_id=u.id,
                            nickname="가", weekly_roi=Decimal("2"), reward_amount=Decimal("500000")),
    ])
    await session.commit()
    weekly = await ws_svc.weekly_results(session, s.id, 4)
    assert weekly == [{"season_id": s.id, "week_start": "2027-03-01", "entries": [
        {"rank": 1, "nickname": "가", "weekly_roi": 2.0, "reward_amount": 500000.0}]}]
    monthly = await ms_svc.monthly_results(session, s.id, 3)
    assert monthly == [{"season_id": s.id, "month_start": "2027-03-01", "entries": [
        {"rank": 1, "nickname": "가", "monthly_roi": 9.0, "reward_amount": 1500000.0}]}]
    unseen = await ws_svc.unseen_rewards(session, u.id)
    assert sorted((x["period_type"], x["reward_amount"]) for x in unseen) == [("month", 1500000.0),
                                                                              ("week", 500000.0)]


def test_beat_schedule_close_trading_month():
    from celery.schedules import crontab
    from apps.collector.celery_app import celery_app
    import apps.collector.tasks.weekly_close as wc
    entry = celery_app.conf.beat_schedule["close-trading-month"]
    assert entry["task"] == "close_trading_month"
    assert entry["schedule"] == crontab(hour=8, minute=55, day_of_month=1)
    assert wc.close_trading_month.name == "close_trading_month"


# ---------------------------------------------------------------- 월간 API
async def test_monthly_leaderboard_my_rank_and_results_api(api, fake_redis, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        s = await _q_season(db)
        u1 = await _seed_user(db, nickname="가")
        u2 = await _seed_user(db, nickname="나")
        db.add(WeeklyRankingResult(season_id=s.id, period_type="month", week_start=M11, rank=1, user_id=u1.id,
                                   nickname="가", weekly_roi=Decimal("7"), reward_amount=Decimal("1500000")))
        await db.commit()
    monkeypatch.setattr(ms_svc, "_now", lambda: kst(2026, 12, 10, 12))
    M12 = date(2026, 12, 1)
    await fake_redis.zadd(mr.month_key(s.id, M12), {str(u1.id): 1.5, str(u2.id): 3.0})
    body = (await client.get(f"/api/game/seasons/{s.id}/monthly-leaderboard")).json()
    assert body["month_start"] == "2026-12-01"
    assert body["start_at"] == kst(2026, 12, 1, 9).isoformat() and body["end_at"] == Q_END.isoformat()
    assert body["entries"] == [{"rank": 1, "user_id": u2.id, "nickname": "나", "monthly_roi": 3.0},
                               {"rank": 2, "user_id": u1.id, "nickname": "가", "monthly_roi": 1.5}]
    set_user(u1)
    assert (await client.get(f"/api/game/seasons/{s.id}/monthly-my-rank")).json() == {
        "rank": 2, "monthly_roi": 1.5, "total": 2}
    res = (await client.get(f"/api/game/monthly-results?season_id={s.id}")).json()
    assert res == [{"season_id": s.id, "month_start": "2026-11-01", "entries": [
        {"rank": 1, "nickname": "가", "monthly_roi": 7.0, "reward_amount": 1500000.0}]}]
    unseen = (await client.get("/api/game/weekly-rewards/unseen")).json()
    assert [(x["period_type"], x["week_start"], x["rank"]) for x in unseen] == [("month", "2026-11-01", 1)]
    assert (await client.post(f"/api/game/weekly-rewards/{unseen[0]['id']}/ack")).status_code == 204
    assert (await client.get("/api/game/weekly-rewards/unseen")).json() == []
    assert (await client.get("/api/game/seasons/999/monthly-leaderboard")).status_code == 404
    assert (await client.get("/api/game/seasons/999/monthly-my-rank")).status_code == 404


async def test_monthly_api_empty_for_month_season(api, fake_redis, maker):
    client, set_user = api
    async with maker() as db:
        s = await _season(db)
        u = await _seed_user(db)
    assert (await client.get(f"/api/game/seasons/{s.id}/monthly-leaderboard")).json() == {
        "month_start": None, "start_at": None, "end_at": None, "entries": []}
    set_user(u)
    assert (await client.get(f"/api/game/seasons/{s.id}/monthly-my-rank")).json() == {
        "rank": None, "monthly_roi": None, "total": 0}
    assert (await client.get(f"/api/game/monthly-results?season_id={s.id}")).json() == []
    assert (await client.get("/api/game/monthly-results")).json() == []


def test_current_month_before_season_start_uses_first_month(monkeypatch):
    """정산 직후(새 시즌 시작 전)에는 새 시즌 첫 달을 보여 준다(직전 달 X)."""
    from apps.trading_game.services import monthly_service as m
    season = GameSeason(
        season_number=2, ticker="005930", stock_name="삼성전자", period="quarter",
        start_at=kst(2026, 11, 1, 9), end_at=kst(2026, 12, 31, 20), status="ACTIVE",
    )
    monkeypatch.setattr(m, "_now", lambda: kst(2026, 10, 31, 21))
    month_id, s, e = m.current_month(season)
    assert month_id == date(2026, 11, 1)
    assert s == kst(2026, 11, 1, 9) and e == kst(2026, 12, 1, 9)

"""주간 랭킹 — 순수 함수·랭킹 갱신·마감·API 테스트."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from apps.trading_game.services import weekly_ranking as wr

KST = timezone(timedelta(hours=9))
S_START = datetime(2026, 10, 1, 9, 0, tzinfo=KST)   # 목요일
S_END = datetime(2026, 10, 31, 20, 0, tzinfo=KST)   # 토요일


def k(d, h, m=0):
    return datetime(2026, 10, d, h, m, tzinfo=KST)


@pytest.mark.parametrize("now, week_id, start, end", [
    (k(14, 12), date(2026, 10, 12), k(12, 9), k(19, 9)),        # 수요일
    (k(12, 9), date(2026, 10, 12), k(12, 9), k(19, 9)),         # 월 09:00 정각 = 새 주
    (k(12, 8, 59), date(2026, 10, 5), k(5, 9), k(12, 9)),       # 월 08:59 = 지난주
    (k(2, 10), date(2026, 9, 28), S_START, k(5, 9)),            # 시즌 시작으로 잘림
    (k(30, 15), date(2026, 10, 26), k(26, 9), S_END),           # 시즌 종료로 잘림
])
def test_week_bounds(now, week_id, start, end):
    assert wr.week_bounds(now, S_START, S_END) == (week_id, start, end)


def test_week_bounds_naive_season_is_utc_and_open_end():
    naive_start = datetime(2026, 10, 1, 0, 0)  # SQLite 는 naive 로 돌려줌 → UTC 로 해석
    wid, s, e = wr.week_bounds(k(14, 12), naive_start, None)
    assert wid == date(2026, 10, 12) and s == k(12, 9) and e == k(19, 9)


@pytest.mark.parametrize("roi, base, expected", [
    (Decimal("10"), Decimal("0"), Decimal("10.0000")),
    (Decimal("21"), Decimal("10"), Decimal("10.0000")),      # 1.21/1.10
    (Decimal("-10"), Decimal("20"), Decimal("-25.0000")),    # 0.9/1.2
    (Decimal("5"), Decimal("-100"), Decimal("0")),           # 분모 0 방어
])
def test_weekly_roi(roi, base, expected):
    assert wr.weekly_roi(roi, base) == expected


def test_keys_and_constants():
    assert wr.week_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:ranking"
    assert wr.base_key(3, date(2026, 10, 12)) == "game:season:3:week:2026-10-12:base"
    assert wr.REWARDS == {1: Decimal("500000"), 2: Decimal("300000"), 3: Decimal("200000")}
    assert wr.ARCHIVE_TOP == 10
    assert wr.WEEK_TTL_SEC == 21 * 24 * 3600


# ---------------------------------------------------------------- update_rank 주간 갱신
from fakeredis import aioredis as fake_aioredis  # noqa: E402

from apps.trading_game.services import ranking_service as rs  # noqa: E402

W = date(2026, 10, 12)
WIN = (S_START, S_END)


def _r():
    return fake_aioredis.FakeRedis(decode_responses=True)


async def test_update_rank_first_update_uses_previous_season_score_as_base():
    r = _r()
    await rs.update_rank(r, 1, 7, Decimal("10"), season_window=WIN, now=k(9, 10))   # 지난주
    await rs.update_rank(r, 1, 7, Decimal("21"), season_window=WIN, now=k(14, 10))  # 이번 주 첫 갱신
    assert await r.hget(wr.base_key(1, W), "7") == "10.0"
    assert await r.zscore(wr.week_key(1, W), "7") == pytest.approx(10.0)
    assert await r.zscore(rs.ranking_key(1), "7") == pytest.approx(21.0)          # 시즌 ZSET 불변 동작


async def test_update_rank_base_kept_on_later_updates_and_new_joiner_is_zero():
    r = _r()
    await rs.update_rank(r, 1, 8, Decimal("5"), season_window=WIN, now=k(14, 10))   # 시즌 첫 등장 → base 0
    await rs.update_rank(r, 1, 8, Decimal("-5"), season_window=WIN, now=k(15, 10))
    assert await r.hget(wr.base_key(1, W), "8") == "0.0"
    assert await r.zscore(wr.week_key(1, W), "8") == pytest.approx(-5.0)
    assert 0 < await r.ttl(wr.week_key(1, W)) <= wr.WEEK_TTL_SEC
    assert 0 < await r.ttl(wr.base_key(1, W)) <= wr.WEEK_TTL_SEC


async def test_update_rank_without_window_or_outside_season_skips_weekly():
    r = _r()
    await rs.update_rank(r, 1, 9, Decimal("3"))                                     # 기존 호출 형태
    await rs.update_rank(r, 1, 9, Decimal("4"), season_window=WIN, now=k(31, 21))   # 시즌 종료 후
    assert await r.keys("game:season:1:week:*") == []
    assert await r.zscore(rs.ranking_key(1), "9") == pytest.approx(4.0)


# ---------------------------------------------------------------- model
from sqlalchemy.exc import IntegrityError  # noqa: E402

from shared.game_models import WeeklyRankingResult  # noqa: E402
from tests.test_quest_quiz_streak import (  # noqa: F401,E402 — 픽스처 재사용
    _seed_account, _seed_season, _seed_user, api, fake_redis, maker, session,
)


async def test_weekly_result_roundtrip_and_unique(session):
    u = await _seed_user(session)
    s = await _seed_season(session)
    row = WeeklyRankingResult(season_id=s.id, week_start=W, rank=1, user_id=u.id, nickname="n",
                              weekly_roi=Decimal("12.3456"), reward_amount=Decimal("500000"))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    assert row.id and row.created_at is not None and row.notified_at is None
    session.add(WeeklyRankingResult(season_id=s.id, week_start=W, rank=2, user_id=u.id,
                                    weekly_roi=Decimal("1"), reward_amount=Decimal("0")))
    with pytest.raises(IntegrityError):
        await session.commit()


# ---------------------------------------------------------------- close_week
from sqlalchemy import select  # noqa: E402

from shared.game_models import GamePosition  # noqa: E402
from apps.trading_game.services import weekly_service as ws_svc  # noqa: E402

UTC = timezone.utc


# SQLite 는 tzinfo 를 버리고 벽시계만 저장하고, 서비스는 naive 를 UTC 로 해석한다(wr.aware).
# 그래서 테스트가 DB 에 넣는 시각은 반드시 UTC 로 바꿔 저장한다(KST 그대로면 재조회 시 9시간 밀림).
async def _season_oct(db):
    s = await _seed_season(db)
    s.start_at, s.end_at = S_START.astimezone(UTC), S_END.astimezone(UTC)
    await db.commit()
    return s


async def _open_pos(db, acc, created_at, status="CLOSED"):
    p = GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("70000"),
                     size_amount=Decimal("1000000"), leverage=1, status=status,
                     created_at=created_at.astimezone(UTC))
    db.add(p)
    await db.commit()
    return p


async def _results(db):
    rows = (await db.execute(select(WeeklyRankingResult).order_by(WeeklyRankingResult.rank))).scalars().all()
    return [(r.rank, r.user_id, r.reward_amount) for r in rows]


async def test_close_week_archives_top10_and_rewards_eligible(session):
    r = _r()
    s = await _season_oct(session)
    users = [await _seed_user(session, nickname=f"u{i}") for i in range(12)]
    accs = [await _seed_account(session, u, s) for u in users]
    for i, u in enumerate(users):
        await r.zadd(wr.week_key(s.id, W), {str(u.id): float(100 - i)})
    await _open_pos(session, accs[0], k(13, 10))          # 1위: 이번 주 주문 → 보상
    await _open_pos(session, accs[1], k(9, 10))           # 2위: 지난주 주문만 → 0
    await _open_pos(session, accs[2], k(18, 10))          # 3위: 이번 주(마감 23시간 전) → 보상
    out = await ws_svc.close_week(session, r, s, W, with_reward=True)
    assert out == {"archived": 10, "rewarded": 2}
    res = await _results(session)
    assert len(res) == 10
    assert res[0] == (1, users[0].id, Decimal("500000.00"))
    assert res[1] == (2, users[1].id, Decimal("0.00"))
    assert res[2] == (3, users[2].id, Decimal("200000.00"))
    await session.refresh(accs[0])
    assert accs[0].cash_balance == Decimal("10500000.00")


async def test_close_week_reward_window_boundaries(session):
    """주 창 [월 09:00, 다음 월 09:00) — 직전·끝 시각 주문은 대상 아님(UTC 왕복 후에도)."""
    r = _r()
    s = await _season_oct(session)
    users = [await _seed_user(session, nickname=f"b{i}") for i in range(3)]
    accs = [await _seed_account(session, u, s) for u in users]
    for i, u in enumerate(users):
        await r.zadd(wr.week_key(s.id, W), {str(u.id): float(10 - i)})
    await _open_pos(session, accs[0], k(12, 9))           # 시작 정각 → 포함
    await _open_pos(session, accs[1], k(12, 8, 59))       # 시작 1분 전 → 제외
    await _open_pos(session, accs[2], k(19, 9))           # 끝 정각 → 제외
    assert await ws_svc.close_week(session, r, s, W, with_reward=True) == {"archived": 3, "rewarded": 1}
    assert [x[2] for x in await _results(session)] == [Decimal("500000.00"), Decimal("0.00"), Decimal("0.00")]


async def test_close_week_idempotent_and_no_reward_mode(session):
    r = _r()
    s = await _season_oct(session)
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, k(13, 10))
    await r.zadd(wr.week_key(s.id, W), {str(u.id): 5.0})
    assert await ws_svc.close_week(session, r, s, W, with_reward=False) == {"archived": 1, "rewarded": 0}
    assert await ws_svc.close_week(session, r, s, W, with_reward=True) == {"archived": 0, "rewarded": 0}
    assert await _results(session) == [(1, u.id, Decimal("0.00"))]


async def test_close_week_empty_week(session):
    s = await _season_oct(session)
    assert await ws_svc.close_week(session, _r(), s, W, with_reward=True) == {"archived": 0, "rewarded": 0}


async def test_close_previous_week_skips_week_before_season(session):
    r = _r()
    s = await _season_oct(session)
    out = await ws_svc.close_previous_week(session, r, now=k(5, 8, 50))   # 지난주 = 9/28 주(시즌 10/1 시작 포함)
    assert out == {"week_start": "2026-09-28", "archived": 0, "rewarded": 0}
    s.start_at = k(6, 9).astimezone(UTC)                                   # 시즌이 그 주 이후 시작 → 건너뜀
    await session.commit()
    assert await ws_svc.close_previous_week(session, r, now=k(5, 8, 50)) is None


async def test_settlement_archives_final_week_without_reward(session):
    from apps.trading_game.services import settlement
    r = _r()
    s = await _seed_season(session)
    s.start_at = datetime(2026, 9, 28, 9, 0, tzinfo=KST).astimezone(UTC)
    s.end_at = datetime(2026, 10, 1, 9, 0, tzinfo=KST).astimezone(UTC)  # 이미 지난 종료(정산 대상)
    await session.commit()
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, datetime(2026, 9, 29, 10, 0, tzinfo=KST))
    await r.zadd(wr.week_key(s.id, date(2026, 9, 28)), {str(u.id): 3.0})
    await settlement.settle_due_season(session, r, lambda t: Decimal("70000"))
    assert await _results(session) == [(1, u.id, Decimal("0.00"))]


# ---------------------------------------------------------------- API
async def test_weekly_leaderboard_and_my_rank(api, fake_redis, maker, monkeypatch):
    client, set_user = api
    async with maker() as db:
        s = await _season_oct(db)
        u1 = await _seed_user(db, nickname="가")
        u2 = await _seed_user(db, nickname="나")
    monkeypatch.setattr(ws_svc, "_now", lambda: k(14, 12))
    await fake_redis.zadd(wr.week_key(s.id, W), {str(u1.id): 1.5, str(u2.id): 3.0})
    res = await client.get(f"/api/game/seasons/{s.id}/weekly-leaderboard")
    assert res.status_code == 200
    body = res.json()
    assert body["week_start"] == "2026-10-12"
    assert body["start_at"] == k(12, 9).isoformat() and body["end_at"] == k(19, 9).isoformat()
    assert [(e["rank"], e["nickname"], e["weekly_roi"]) for e in body["entries"]] == [(1, "나", 3.0), (2, "가", 1.5)]
    set_user(u1)
    me = (await client.get(f"/api/game/seasons/{s.id}/weekly-my-rank")).json()
    assert me == {"rank": 2, "weekly_roi": 1.5, "total": 2}
    assert (await client.get("/api/game/seasons/999/weekly-leaderboard")).status_code == 404


async def test_weekly_leaderboard_after_season_end_shows_last_week(api, fake_redis, maker, monkeypatch):
    client, _ = api
    async with maker() as db:
        s = await _season_oct(db)
    monkeypatch.setattr(ws_svc, "_now", lambda: k(31, 21))   # 시즌 종료(10/31 20:00) 이후
    body = (await client.get(f"/api/game/seasons/{s.id}/weekly-leaderboard")).json()
    assert body["week_start"] == "2026-10-26"
    assert body["end_at"] == S_END.isoformat()


async def test_weekly_results_unseen_and_ack(api, fake_redis, maker):
    client, set_user = api
    async with maker() as db:
        s = await _season_oct(db)
        u1 = await _seed_user(db, nickname="가")
        u2 = await _seed_user(db, nickname="나")
        db.add_all([
            WeeklyRankingResult(season_id=s.id, week_start=W, rank=1, user_id=u1.id, nickname="가",
                                weekly_roi=Decimal("9"), reward_amount=Decimal("500000")),
            WeeklyRankingResult(season_id=s.id, week_start=W, rank=2, user_id=u2.id, nickname="나",
                                weekly_roi=Decimal("4"), reward_amount=Decimal("0")),
        ])
        await db.commit()
    results = (await client.get(f"/api/game/weekly-results?season_id={s.id}")).json()
    assert results == [{"season_id": s.id, "week_start": "2026-10-12", "entries": [
        {"rank": 1, "nickname": "가", "weekly_roi": 9.0, "reward_amount": 500000.0},
        {"rank": 2, "nickname": "나", "weekly_roi": 4.0, "reward_amount": 0.0},
    ]}]
    set_user(u1)
    unseen = (await client.get("/api/game/weekly-rewards/unseen")).json()
    assert [(x["rank"], x["reward_amount"], x["week_start"]) for x in unseen] == [(1, 500000.0, "2026-10-12")]
    set_user(u2)
    assert (await client.post(f"/api/game/weekly-rewards/{unseen[0]['id']}/ack")).status_code == 404  # 남의 것
    set_user(u1)
    assert (await client.post(f"/api/game/weekly-rewards/{unseen[0]['id']}/ack")).status_code == 204
    assert (await client.get("/api/game/weekly-rewards/unseen")).json() == []


async def test_close_previous_week_final_week_without_reward_when_settlement_delayed(session):
    """정산이 월 08:50 이후로 밀려 시즌이 아직 ACTIVE 여도, 시즌 마지막 주는 기록만(보상 0)."""
    r = _r()
    s = await _season_oct(session)                       # 종료 10/31(토) 20:00
    u = await _seed_user(session)
    acc = await _seed_account(session, u, s)
    await _open_pos(session, acc, k(27, 10))
    await r.zadd(wr.week_key(s.id, date(2026, 10, 26)), {str(u.id): 5.0})
    now = datetime(2026, 11, 2, 8, 50, tzinfo=KST)        # 다음 월 08:50 — 지난주 = 10/26 주(마지막 주)
    out = await ws_svc.close_previous_week(session, r, now=now)
    assert out == {"week_start": "2026-10-26", "archived": 1, "rewarded": 0}
    assert await _results(session) == [(1, u.id, Decimal("0.00"))]
    await session.refresh(acc)
    assert acc.cash_balance == Decimal("10000000.00")

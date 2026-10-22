"""회원 탈퇴 — DELETE /api/v1/auth/me (auth 서비스).

DB 는 sqlite in-memory(FK ON — CASCADE/SET NULL 검증), Redis 는 fakeredis,
카카오 연결 끊기는 httpx.MockTransport. 인증은 override 없이 실제 JWT 를 쓴다
(탈퇴 후 같은 토큰으로 /me → 401 을 보장하기 위해).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth import deps as auth_deps
from apps.auth.main import app
from apps.auth.services import account_deletion
from apps.auth.social.config import SocialSettings, get_social_settings
from apps.auth.social.providers import get_http_transport
from apps.trading_game.services import weekly_service
from apps.trading_game.services.ranking_service import ranking_key
from apps.trading_game.services.weekly_ranking import base_key, week_key
from shared.database import get_db
from shared.game_models import (
    ChartQuiz, GameAccount, GameCoachMessage, GamePosition, GameSeason, GameTrade, HallOfFame,
    StreakRewardClaim, UserAcademy, UserBadge, UserQuestProgress, UserQuizAttempt, UserStreak,
    WeeklyRankingResult,
)
from shared.models import AuthProvider, Base, BlogComment, BlogPost, Board, User, UserRole
from shared.security import create_access_token

ME = "/api/v1/auth/me"
CONFIRM = {"confirm": "탈퇴"}
ANON = "탈퇴한 회원"
UNLINK_URL = "https://kapi.kakao.com/v1/user/unlink"


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _rec):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def ctx(maker):
    """ctx.client + 바꿔 끼울 수 있는 ctx.settings / ctx.transport / ctx.redis, ctx.calls(카카오 요청)."""
    state = SimpleNamespace(
        maker=maker,
        settings=SocialSettings(),
        redis=fake_aioredis.FakeRedis(decode_responses=True),
        calls=[],
    )

    def _handler(request: httpx.Request) -> httpx.Response:
        state.calls.append(request)
        return httpx.Response(200, json={"id": 1})

    state.transport = httpx.MockTransport(_handler)

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_social_settings] = lambda: state.settings
    app.dependency_overrides[get_http_transport] = lambda: state.transport
    app.dependency_overrides[auth_deps.get_redis] = lambda: state.redis
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        state.client = client
        yield state
    app.dependency_overrides.clear()


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=user.id, role=user.role.value)}"}


async def _seed_user(db, *, role=UserRole.FREE, nickname="플레이어", provider=None, provider_id=None) -> User:
    u = User(nickname=nickname, role=role, is_active=True, provider=provider, provider_id=provider_id)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _seed_season(db, number: int = 1, status: str = "ACTIVE") -> GameSeason:
    season = GameSeason(
        season_number=number, ticker="005930", stock_name="삼성전자",
        start_at=datetime(2026, 10, 1, tzinfo=timezone.utc), status=status,
    )
    db.add(season)
    await db.commit()
    await db.refresh(season)
    return season


async def _seed_account(db, user, season) -> GameAccount:
    acc = GameAccount(user_id=user.id, season_id=season.id)
    db.add(acc)
    await db.commit()
    await db.refresh(acc)
    return acc


async def _count(db, model, *where) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(*where))


# ---------------------------------------------------------------- 성공 · CASCADE
async def test_delete_cascades_owned_data_and_nulls_authored(ctx):
    async with ctx.maker() as db:
        me = await _seed_user(db, nickname="떠나는사람")
        other = await _seed_user(db, nickname="남는사람")
        season = await _seed_season(db)
        acc = await _seed_account(db, me, season)
        other_acc = await _seed_account(db, other, season)
        quiz = ChartQuiz(
            ticker="005930", base_date=date(2026, 9, 1), pattern_type="골든크로스",
            chart_snapshot=[], answer="UP", actual_change=Decimal("1"), explanation="해설",
        )
        board = Board(name="자유")
        db.add_all([quiz, board])
        await db.commit()
        post = BlogPost(board_id=board.id, author_id=me.id, title="글", content="본문")
        other_post = BlogPost(board_id=board.id, author_id=other.id, title="남의 글", content="본문")
        db.add_all([
            post, other_post,
            GamePosition(account_id=acc.id, side="LONG", entry_price=Decimal("100"), size_amount=Decimal("1000")),
            GameTrade(
                account_id=acc.id, side="LONG", entry_price=Decimal("100"), exit_price=Decimal("110"),
                pnl_amount=Decimal("100"), roi_pct=Decimal("10"), closed_reason="MANUAL",
            ),
            UserQuestProgress(user_id=me.id, quest_code="Q1_STOP_LOSS"),
            UserBadge(user_id=me.id, badge_code="PRINCIPLED"),
            UserAcademy(user_id=me.id),
            UserQuizAttempt(user_id=me.id, quiz_id=quiz.id, served_at=datetime.now(timezone.utc)),
            UserStreak(user_id=me.id),
            UserStreak(user_id=other.id),
            StreakRewardClaim(user_id=me.id, season_id=season.id, milestone=7, amount=Decimal("100000")),
            GameCoachMessage(
                season_id=season.id, target_date=date(2026, 10, 14), coach_type="MORNING", title="t",
                summary_nudge="s", content_md="c", author_id=me.id,
            ),
        ])
        await db.commit()
        db.add_all([
            BlogComment(post_id=other_post.id, author_id=me.id, content="내 댓글"),
            BlogComment(post_id=other_post.id, author_id=other.id, content="남의 댓글"),
        ])
        await db.commit()
        me_id, other_id, post_id = me.id, other.id, post.id

    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text
    assert r.content == b""

    async with ctx.maker() as db:
        assert await db.get(User, me_id) is None
        assert await db.get(User, other_id) is not None
        assert await _count(db, GameAccount, GameAccount.user_id == me_id) == 0
        assert await _count(db, GameAccount, GameAccount.id == other_acc.id) == 1
        assert await _count(db, GamePosition) == 0
        assert await _count(db, GameTrade) == 0
        for model in (UserQuestProgress, UserBadge, UserAcademy, UserQuizAttempt, StreakRewardClaim):
            assert await _count(db, model, model.user_id == me_id) == 0, model.__name__
        assert await _count(db, UserStreak, UserStreak.user_id == other_id) == 1
        assert await _count(db, BlogComment, BlogComment.author_id == me_id) == 0
        assert await _count(db, BlogComment, BlogComment.author_id == other_id) == 1
        # 글·코치 메시지는 남고 author 만 NULL
        assert (await db.get(BlogPost, post_id)).author_id is None
        assert await db.scalar(select(GameCoachMessage.author_id)) is None
        assert await _count(db, ChartQuiz) == 1  # 퀴즈 풀 자체는 공용


# ---------------------------------------------------------------- 익명화
async def test_public_records_are_anonymized_not_deleted(ctx):
    async with ctx.maker() as db:
        me = await _seed_user(db, nickname="전설")
        other = await _seed_user(db, nickname="2등")
        season = await _seed_season(db, status="ENDED")
        db.add_all([
            HallOfFame(season_id=season.id, rank=1, user_id=me.id, user_nickname="전설",
                       final_roi=Decimal("50"), final_asset=Decimal("15000000"), win_rate=Decimal("70")),
            HallOfFame(season_id=season.id, rank=2, user_id=other.id, user_nickname="2등",
                       final_roi=Decimal("30"), final_asset=Decimal("13000000"), win_rate=Decimal("60")),
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 5), rank=1, user_id=me.id,
                                nickname="전설", weekly_roi=Decimal("9"), reward_amount=Decimal("500000")),
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 12), rank=1, user_id=me.id,
                                nickname="전설", weekly_roi=Decimal("5"), reward_amount=Decimal("0")),
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 5), rank=2, user_id=other.id,
                                nickname="2등", weekly_roi=Decimal("4"), reward_amount=Decimal("300000")),
        ])
        await db.commit()
        me_id, other_id = me.id, other.id

    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text

    async with ctx.maker() as db:
        hof = {h.rank: h for h in (await db.execute(select(HallOfFame))).scalars()}
        assert (hof[1].user_id, hof[1].user_nickname, hof[1].final_roi) == (None, ANON, Decimal("50"))
        assert (hof[2].user_id, hof[2].user_nickname) == (other_id, "2등")
        weekly = (await db.execute(select(WeeklyRankingResult).order_by(WeeklyRankingResult.id))).scalars().all()
        assert len(weekly) == 3  # 행은 유지
        assert [(w.user_id, w.nickname) for w in weekly] == [(None, ANON), (None, ANON), (other_id, "2등")]
        assert await _count(db, WeeklyRankingResult, WeeklyRankingResult.user_id == me_id) == 0


# ---------------------------------------------------------------- Redis 정리
async def test_redis_rankings_cleaned_for_all_seasons_and_weeks(ctx):
    async with ctx.maker() as db:
        me = await _seed_user(db)
        other = await _seed_user(db, nickname="남는사람")
        s1 = await _seed_season(db, number=1, status="ENDED")
        s2 = await _seed_season(db, number=2)
    m, o = str(me.id), str(other.id)
    w1, w2 = date(2026, 10, 5), date(2026, 10, 12)
    redis = ctx.redis
    for sid in (s1.id, s2.id):
        await redis.zadd(ranking_key(sid), {m: 3.0, o: 1.0})
    for wk in (w1, w2):
        await redis.zadd(week_key(s2.id, wk), {m: 2.0, o: 0.5})
        await redis.hset(base_key(s2.id, wk), mapping={m: "1.0", o: "0.5"})
    await redis.set("game:season:1:unrelated", "keep")

    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text

    for sid in (s1.id, s2.id):
        assert await redis.zscore(ranking_key(sid), m) is None
        assert await redis.zscore(ranking_key(sid), o) == 1.0
    for wk in (w1, w2):
        assert await redis.zscore(week_key(s2.id, wk), m) is None
        assert await redis.zscore(week_key(s2.id, wk), o) == 0.5
        assert await redis.hget(base_key(s2.id, wk), m) is None
        assert await redis.hget(base_key(s2.id, wk), o) == "0.5"
    assert await redis.get("game:season:1:unrelated") == "keep"


class _BrokenRedis:
    """모든 호출이 연결 오류 — 베스트 에포트 확인용."""

    def __getattr__(self, name):
        async def _fail(*_a, **_k):
            raise RedisConnectionError("down")

        def _scan_iter(*_a, **_k):
            async def _gen():
                raise RedisConnectionError("down")
                yield  # pragma: no cover

            return _gen()

        return _scan_iter if name == "scan_iter" else _fail


async def test_redis_failure_still_deletes_and_returns_204(ctx):
    ctx.redis = _BrokenRedis()
    async with ctx.maker() as db:
        me = await _seed_user(db)
        await _seed_season(db)
        me_id = me.id
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text
    async with ctx.maker() as db:
        assert await db.get(User, me_id) is None


def test_redis_key_patterns_match_trading_game_helpers():
    """auth 쪽 키 패턴이 trading_game 키 함수와 어긋나지 않게 고정."""
    assert account_deletion.season_ranking_key(7) == ranking_key(7)
    wk = date(2026, 10, 12)
    import fnmatch
    assert fnmatch.fnmatchcase(week_key(7, wk), account_deletion.WEEK_RANKING_PATTERN)
    assert fnmatch.fnmatchcase(base_key(7, wk), account_deletion.WEEK_BASE_PATTERN)
    assert not fnmatch.fnmatchcase(ranking_key(7), account_deletion.WEEK_RANKING_PATTERN)


# ---------------------------------------------------------------- 거절
@pytest.mark.parametrize(
    "kwargs",
    [
        {},  # 본문 없음
        {"json": {}},
        {"json": {"confirm": "탈퇴할래"}},
        {"json": {"confirm": ""}},
        {"json": {"confirm": None}},
        {"json": {"confirm": "탈퇴" * 50}},  # 길어도 422 가 아니라 400
    ],
)
async def test_confirm_required(ctx, kwargs):
    async with ctx.maker() as db:
        me = await _seed_user(db)
        me_id = me.id
    r = await ctx.client.request("DELETE", ME, headers=_auth(me), **kwargs)
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["code"] == "CONFIRM_REQUIRED"
    async with ctx.maker() as db:
        assert await db.get(User, me_id) is not None


async def test_admin_cannot_delete(ctx):
    async with ctx.maker() as db:
        admin = await _seed_user(db, role=UserRole.ADMIN, nickname="관리자")
        admin_id = admin.id
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(admin))
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "ADMIN_CANNOT_DELETE"
    async with ctx.maker() as db:
        assert await db.get(User, admin_id) is not None


async def test_requires_auth(ctx):
    r = await ctx.client.request("DELETE", ME, json=CONFIRM)
    assert r.status_code == 401


async def test_old_token_rejected_after_deletion(ctx):
    async with ctx.maker() as db:
        me = await _seed_user(db)
    headers = _auth(me)
    assert (await ctx.client.get(ME, headers=headers)).status_code == 200
    assert (await ctx.client.request("DELETE", ME, json=CONFIRM, headers=headers)).status_code == 204
    assert (await ctx.client.get(ME, headers=headers)).status_code == 401
    # 두 번째 탈퇴 요청도 401(이미 없는 사용자)
    assert (await ctx.client.request("DELETE", ME, json=CONFIRM, headers=headers)).status_code == 401


# ---------------------------------------------------------------- 카카오 연결 끊기
async def test_kakao_unlink_called_with_admin_key(ctx):
    ctx.settings = SocialSettings(kakao_admin_key="admin-key-123")
    async with ctx.maker() as db:
        me = await _seed_user(db, provider=AuthProvider.KAKAO, provider_id="4242")
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text
    assert len(ctx.calls) == 1
    req = ctx.calls[0]
    assert req.method == "POST"
    assert str(req.url) == UNLINK_URL
    assert req.headers["Authorization"] == "KakaoAK admin-key-123"
    assert parse_qs(req.content.decode()) == {"target_id_type": ["user_id"], "target_id": ["4242"]}


async def test_kakao_unlink_skipped_without_admin_key(ctx):
    async with ctx.maker() as db:
        me = await _seed_user(db, provider=AuthProvider.KAKAO, provider_id="4242")
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204
    assert ctx.calls == []


async def test_kakao_unlink_skipped_for_naver(ctx):
    ctx.settings = SocialSettings(kakao_admin_key="admin-key-123")
    async with ctx.maker() as db:
        me = await _seed_user(db, provider=AuthProvider.NAVER, provider_id="n-1")
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204
    assert ctx.calls == []


@pytest.mark.parametrize("mode", ["http_error", "network_error"])
async def test_kakao_unlink_failure_still_204(ctx, mode):
    ctx.settings = SocialSettings(kakao_admin_key="admin-key-123")

    def _handler(request: httpx.Request) -> httpx.Response:
        ctx.calls.append(request)
        if mode == "network_error":
            raise httpx.ConnectTimeout("timeout", request=request)
        return httpx.Response(401, json={"msg": "unauthorized"})

    ctx.transport = httpx.MockTransport(_handler)
    async with ctx.maker() as db:
        me = await _seed_user(db, provider=AuthProvider.KAKAO, provider_id="4242")
        me_id = me.id
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text
    assert len(ctx.calls) == 1
    async with ctx.maker() as db:
        assert await db.get(User, me_id) is None


# ---------------------------------------------------------------- 주간 보상 회귀(NULL 행)
async def test_unseen_rewards_and_ack_ignore_anonymized_rows(maker):
    async with maker() as db:
        me = await _seed_user(db)
        season = await _seed_season(db)
        db.add_all([
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 5), rank=1, user_id=None,
                                nickname=ANON, weekly_roi=Decimal("9"), reward_amount=Decimal("500000")),
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 12), rank=1, user_id=None,
                                nickname=ANON, weekly_roi=Decimal("8"), reward_amount=Decimal("500000")),
            WeeklyRankingResult(season_id=season.id, week_start=date(2026, 10, 5), rank=2, user_id=me.id,
                                nickname="나", weekly_roi=Decimal("4"), reward_amount=Decimal("300000")),
        ])
        await db.commit()
        unseen = await weekly_service.unseen_rewards(db, me.id)
        assert [u["rank"] for u in unseen] == [2]
        anon_id = await db.scalar(select(WeeklyRankingResult.id).where(WeeklyRankingResult.user_id.is_(None)).limit(1))
        assert await weekly_service.ack_reward(db, me.id, anon_id) is False


async def test_open_sockets_notified_after_deletion(ctx, monkeypatch):
    """탈퇴 뒤 플랫폼별 세션마다 종료 알림 — 열린 게임 소켓을 즉시 닫게(다음 접속까지 기다리지 않게)."""
    from apps.auth.services import account_deletion as ad
    from shared.models import UserSession

    calls = []

    async def fake_publish(redis, user_id, platform, sid):
        calls.append((user_id, platform, sid))

    monkeypatch.setattr(ad, "publish_session_ended", fake_publish)
    async with ctx.maker() as db:
        me = await _seed_user(db)
        db.add_all([UserSession(user_id=me.id, platform="app", sid="sid-app"),
                    UserSession(user_id=me.id, platform="web", sid="sid-web")])
        await db.commit()
        me_id = me.id
    r = await ctx.client.request("DELETE", ME, json=CONFIRM, headers=_auth(me))
    assert r.status_code == 204, r.text
    assert sorted(calls) == [(me_id, "app", "sid-app"), (me_id, "web", "sid-web")]

"""회원 탈퇴 UseCase — 즉시 삭제 + 공개 기록 익명화.

한 트랜잭션: 명예의 전당·주간 결과 익명화(user_id NULL, 닉네임 '탈퇴한 회원') → users 행 삭제.
나머지 연관 데이터는 DB FK 규칙(CASCADE / SET NULL)이 처리한다.
커밋 후 베스트 에포트(실패해도 탈퇴는 성공): Redis 랭킹 정리, 카카오 연결 끊기.
"""
from __future__ import annotations

import logging

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.game_models import GameSeason, HallOfFame, WeeklyRankingResult
from shared.models import AuthProvider, RefreshToken, User, UserRole, UserSession

log = logging.getLogger("auth.account_deletion")

CONFIRM_PHRASE = "탈퇴"
ANONYMOUS_NICKNAME = "탈퇴한 회원"

KAKAO_UNLINK_URL = "https://kapi.kakao.com/v1/user/unlink"
KAKAO_TIMEOUT_SECONDS = 5.0

# trading_game 키와 동일해야 한다(ranking_service.ranking_key / weekly_ranking.week_key·base_key).
# auth 가 trading_game 을 import 하지 않도록 패턴만 둔다 — 일치 여부는 테스트로 고정.
WEEK_RANKING_PATTERN = "game:season:*:week:*:ranking"
WEEK_BASE_PATTERN = "game:season:*:week:*:base"
# 월간(분기 시즌) — monthly_ranking.month_key·base_key 와 동일해야 한다
MONTH_RANKING_PATTERN = "game:season:*:month:*:ranking"
MONTH_BASE_PATTERN = "game:season:*:month:*:base"


def season_ranking_key(season_id: int) -> str:
    return f"game:season:{season_id}:ranking"


class AccountDeletionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


async def delete_account(
    db: AsyncSession,
    user: User,
    *,
    confirm: str | None,
    redis,
    kakao_admin_key: str = "",
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """탈퇴 처리. 거절은 AccountDeletionError(CONFIRM_REQUIRED / ADMIN_CANNOT_DELETE)."""
    if user.role == UserRole.ADMIN:
        raise AccountDeletionError("ADMIN_CANNOT_DELETE", "관리자 계정은 탈퇴할 수 없습니다.")
    if confirm != CONFIRM_PHRASE:
        raise AccountDeletionError("CONFIRM_REQUIRED", f"확인 문구 '{CONFIRM_PHRASE}'를 입력해 주세요.")

    # 커밋 후 ORM 객체에 기대지 않도록 미리 잡아 둔다.
    uid, provider, provider_id = user.id, user.provider, user.provider_id
    season_ids = list((await db.execute(select(GameSeason.id))).scalars())

    try:
        await db.execute(
            update(HallOfFame).where(HallOfFame.user_id == uid)
            .values(user_id=None, user_nickname=ANONYMOUS_NICKNAME)
        )
        await db.execute(
            update(WeeklyRankingResult).where(WeeklyRankingResult.user_id == uid)
            .values(user_id=None, nickname=ANONYMOUS_NICKNAME)
        )
        # 운영 PG 는 FK CASCADE 로도 지워지지만, 방언(sqlite 테스트) 무관하게 명시 삭제
        await db.execute(delete(RefreshToken).where(RefreshToken.user_id == uid))
        await db.execute(delete(UserSession).where(UserSession.user_id == uid))
        await db.execute(delete(User).where(User.id == uid))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    log.info("회원 탈퇴 완료 user=%s", uid)

    await _cleanup_rankings(redis, uid, season_ids)
    if provider == AuthProvider.KAKAO and kakao_admin_key and provider_id:
        await _kakao_unlink(kakao_admin_key, provider_id, transport)


async def _cleanup_rankings(redis, uid: int, season_ids: list[int]) -> None:
    """시즌 랭킹 ZREM + 주간·월간 랭킹 ZREM·기준 HDEL(SCAN, KEYS 금지). 실패는 경고만."""
    member = str(uid)
    try:
        for sid in season_ids:
            await redis.zrem(season_ranking_key(sid), member)
        for pattern in (WEEK_RANKING_PATTERN, MONTH_RANKING_PATTERN):
            async for key in redis.scan_iter(match=pattern, count=200):
                await redis.zrem(key, member)
        for pattern in (WEEK_BASE_PATTERN, MONTH_BASE_PATTERN):
            async for key in redis.scan_iter(match=pattern, count=200):
                await redis.hdel(key, member)
    except Exception as exc:  # noqa: BLE001 — 베스트 에포트(탈퇴는 이미 커밋됨)
        log.warning("탈퇴 후 Redis 랭킹 정리 실패 user=%s: %s", uid, exc)


async def _kakao_unlink(admin_key: str, provider_id: str, transport: httpx.AsyncBaseTransport | None) -> None:
    """카카오 연결 끊기(Admin 키 방식). 실패는 경고만."""
    try:
        async with httpx.AsyncClient(timeout=KAKAO_TIMEOUT_SECONDS, transport=transport) as http:
            resp = await http.post(
                KAKAO_UNLINK_URL,
                headers={"Authorization": f"KakaoAK {admin_key}"},
                data={"target_id_type": "user_id", "target_id": provider_id},
            )
        if not resp.is_success:
            log.warning("카카오 연결 끊기 실패 status=%s", resp.status_code)
    except httpx.HTTPError as exc:
        log.warning("카카오 연결 끊기 요청 실패: %s", exc)

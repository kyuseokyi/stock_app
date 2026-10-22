"""앱 리프레시 토큰 — 발급·회전·재사용 감지·로그아웃·정리.

설계: docs/superpowers/specs/2026-10-22-mobile-refresh-token-design.md
- 원문은 클라이언트만 갖고 DB 엔 SHA-256 해시만 저장한다.
- 리프레시는 로그인 sid 에 묶인다. 갱신은 sid 를 유지(새 세션 아님 → SESSION_REPLACED 발행 없음).
- 회전은 행 잠금(SELECT … FOR UPDATE)으로 원자 처리(auth replicas 2). sqlite 테스트에선 잠금이 무시돼도 같은 흐름.
- 이미 쓴 토큰이 다시 오면 30초 안은 유예(다시 회전, 앞서 만든 후속 토큰 폐기), 지나면 탈취로 보고
  그 sid 리프레시 전부 폐기 + 앱 세션 삭제 → REFRESH_REUSED.
  단 유예 안이라도 후속 토큰이 이미 쓰였거나(정상 응답 유실이면 후속은 아무도 못 씀), 이미 쓰인 뒤 폐기된 토큰이
  다시 오면(유예 재회전으로 공격자 체인을 덮는 것 방지) 재사용으로 본다.
- 세션 종료(재사용 감지·로그아웃·비활성)는 commit 뒤 Redis 로 알려(best-effort) 열린 게임 WS 를 닫게 한다.
- 같은 sid 행을 일괄 UPDATE 하기 전에 id 순으로 잠가 동시 요청 간 잠금 순서를 맞춘다(제시된 토큰 행을 먼저 잠그는 것은 예외).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import RefreshToken, User, UserSession
from shared.security import (
    APP_EXPIRE_MINUTES,
    REFRESH_EXPIRE_DAYS,
    create_access_token,
    hash_refresh_token,
    new_refresh_token,
)
from shared.sessions import (
    SESSION_ENDED,
    SESSION_ENDED_MESSAGE,
    SESSION_REPLACED,
    SESSION_REPLACED_MESSAGE,
    publish_session_ended,
)

log = logging.getLogger("auth.refresh_tokens")

APP_PLATFORM = "app"
REUSE_GRACE = timedelta(seconds=30)
CLEANUP_AFTER = timedelta(days=7)

REFRESH_INVALID = "REFRESH_INVALID"
REFRESH_EXPIRED = "REFRESH_EXPIRED"
REFRESH_REUSED = "REFRESH_REUSED"

_MESSAGES = {
    REFRESH_INVALID: "로그인 정보가 올바르지 않아요. 다시 로그인해 주세요.",
    REFRESH_EXPIRED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
    REFRESH_REUSED: "보안을 위해 로그아웃됐어요. 다시 로그인해 주세요.",
    SESSION_REPLACED: SESSION_REPLACED_MESSAGE,
    SESSION_ENDED: SESSION_ENDED_MESSAGE,
}


class RefreshError(Exception):
    """갱신 거절 — code 는 REFRESH_INVALID/EXPIRED/REUSED·SESSION_REPLACED/ENDED, 라우터가 401 로 변환."""

    def __init__(self, code: str):
        super().__init__(_MESSAGES[code])
        self.code = code
        self.message = _MESSAGES[code]


@dataclass(frozen=True)
class RefreshResult:
    user: User
    access_token: str
    refresh_token: str
    expires_in: int


def _utcnow() -> datetime:
    """현재 UTC — 테스트는 monkeypatch 로 바꾼다."""
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """sqlite 는 timezone=True 컬럼도 naive 로 돌려준다 → UTC 로 간주."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def app_access_expires_in() -> int:
    """앱 접근 토큰 수명(초) — 응답 expires_in."""
    return APP_EXPIRE_MINUTES * 60


async def _cleanup(db: AsyncSession, user_id: int, now: datetime) -> None:
    """같은 사용자의 만료·폐기 후 7일 지난 행 삭제(commit 은 호출자). 회전된(사용된) 행은 만료까지 남겨 재사용 감지에 쓴다."""
    cutoff = now - CLEANUP_AFTER
    await db.execute(
        delete(RefreshToken).where(
            RefreshToken.user_id == user_id,
            or_(
                RefreshToken.expires_at < cutoff,
                and_(RefreshToken.revoked_at.is_not(None), RefreshToken.revoked_at < cutoff),
            ),
        )
        .execution_options(synchronize_session=False)
    )


def _new_row(user_id: int, sid: str, now: datetime) -> tuple[RefreshToken, str]:
    raw = new_refresh_token()
    row = RefreshToken(
        user_id=user_id,
        platform=APP_PLATFORM,
        sid=sid,
        token_hash=hash_refresh_token(raw),
        created_at=now,
        expires_at=now + timedelta(days=REFRESH_EXPIRE_DAYS),
    )
    return row, raw


async def issue(db: AsyncSession, user_id: int, sid: str, *, now: datetime | None = None) -> str:
    """로그인 직후 리프레시 발급(+ 오래된 행 정리) 후 commit → 원문 토큰."""
    now = now or _utcnow()
    await _cleanup(db, user_id, now)
    row, raw = _new_row(user_id, sid, now)
    db.add(row)
    await db.commit()
    return raw


async def _revoke_sid(
    db: AsyncSession, user_id: int, sid: str, now: datetime, *, except_id: int | None = None
) -> None:
    # PostgreSQL UPDATE 는 ORDER BY 를 못 쓴다 → 대상 행을 id 순으로 먼저 잠가 동시 요청 간 잠금 순서를 맞춘다(sqlite 는 무시)
    await db.execute(
        select(RefreshToken.id)
        .where(RefreshToken.user_id == user_id, RefreshToken.sid == sid, RefreshToken.revoked_at.is_(None))
        .order_by(RefreshToken.id)
        .with_for_update()
    )
    stmt = (
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.sid == sid, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
        # 파이썬 쪽 동기화 평가 생략(sqlite 의 naive 시각과 비교 오류). 이후 로직은 이 행 객체의 revoked_at 을 읽지 않는다
        .execution_options(synchronize_session=False)
    )
    if except_id is not None:
        stmt = stmt.where(RefreshToken.id != except_id)
    await db.execute(stmt)


async def _end_app_session(db: AsyncSession, user_id: int, sid: str) -> None:
    """앱 세션 행 삭제 — 그 sid 가 아직 현재일 때만(재로그인한 새 기기는 건드리지 않음). 조건부 DELETE 라 원자적."""
    await db.execute(
        delete(UserSession).where(
            UserSession.user_id == user_id,
            UserSession.platform == APP_PLATFORM,
            UserSession.sid == sid,
        )
        .execution_options(synchronize_session=False)
    )


async def _kill_sid(db: AsyncSession, redis, user_id: int, sid: str, now: datetime) -> None:
    """그 sid 의 리프레시 전부 폐기 + 앱 세션 삭제(sid 같을 때만) → commit → 열린 WS 닫기 알림(best-effort)."""
    await _revoke_sid(db, user_id, sid, now)
    await _end_app_session(db, user_id, sid)
    await db.commit()
    await publish_session_ended(redis, user_id, APP_PLATFORM, sid)


async def _successor_used(db: AsyncSession, row: RefreshToken) -> bool:
    """이 토큰으로 만든(최근) 후속 토큰이 이미 쓰였는가 — 쓰였으면 응답 유실이 아니라 다른 쪽이 체인을 이어 간 것."""
    if row.replaced_by_id is None:
        return False
    successor = (
        await db.execute(select(RefreshToken).where(RefreshToken.id == row.replaced_by_id).with_for_update())
    ).scalar_one_or_none()
    return successor is not None and successor.used_at is not None


async def rotate(db: AsyncSession, raw: str, *, now: datetime | None = None, redis=None) -> RefreshResult:
    """리프레시 → 새 접근 토큰 + 새 리프레시(sid 유지). 실패는 RefreshError(폐기 등 부수효과는 commit 후 raise).

    redis: 세션을 끝낼 때(재사용 감지·비활성) 열린 게임 WS 를 닫게 알릴 클라이언트(None 이면 알림 생략).
    """
    now = now or _utcnow()
    if not raw:
        raise RefreshError(REFRESH_INVALID)
    row = (
        await db.execute(
            select(RefreshToken)
            .where(RefreshToken.token_hash == hash_refresh_token(raw))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise RefreshError(REFRESH_INVALID)
    if row.revoked_at is not None:
        if row.used_at is not None:
            # 이미 쓰인 뒤 폐기된 토큰(유예 재회전·재사용 감지·로그아웃으로 폐기)이 다시 옴 — 탈취로 본다.
            # 세션 삭제는 sid 가 아직 현재일 때만이라 재로그인한 새 기기엔 영향 없음
            await _kill_sid(db, redis, row.user_id, row.sid, now)
            log.warning("폐기된 사용 토큰 재제시 — sid 폐기 user=%s", row.user_id)
            raise RefreshError(REFRESH_REUSED)
        raise RefreshError(REFRESH_INVALID)
    if _aware(row.expires_at) <= now:
        raise RefreshError(REFRESH_EXPIRED)

    user_id, sid = row.user_id, row.sid
    used_at = _aware(row.used_at)
    if used_at is not None and (now - used_at > REUSE_GRACE or await _successor_used(db, row)):
        # 탈취로 본다 — 그 sid 의 리프레시 전부 폐기 + 앱 세션 삭제(기존 접근 토큰도 즉시 무효)
        await _kill_sid(db, redis, user_id, sid, now)
        log.warning("리프레시 재사용 감지 — sid 폐기 user=%s", user_id)
        raise RefreshError(REFRESH_REUSED)

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        await _kill_sid(db, redis, user_id, sid, now)
        raise RefreshError(REFRESH_INVALID)
    session = await db.get(UserSession, (user_id, APP_PLATFORM))
    if session is None or session.sid != sid:
        # 로그아웃 등으로 세션 행이 없거나(종료) 같은 플랫폼 재로그인으로 밀려난 세션(교체) — 이 sid 리프레시는 더 쓸 일이 없다
        await _revoke_sid(db, user_id, sid, now)
        await db.commit()
        raise RefreshError(SESSION_ENDED if session is None else SESSION_REPLACED)

    if used_at is not None:
        # 30초 유예(응답 유실 재시도) — 앞서 만든 후속 토큰(들)을 폐기하고 이 토큰으로 다시 회전. 활성 토큰은 항상 1개.
        # used_at 은 첫 사용 시각 그대로 둔다(유예가 재시도마다 연장되지 않게).
        await _revoke_sid(db, user_id, sid, now, except_id=row.id)
    else:
        row.used_at = now
    await _cleanup(db, user_id, now)
    new_row, new_raw = _new_row(user_id, sid, now)
    db.add(new_row)
    await db.flush()
    row.replaced_by_id = new_row.id
    role = user.role.value
    await db.commit()

    # 접근 토큰 iat/exp 는 실제 시각 기준(주입된 now 는 리프레시 행 시각 판단용)
    access = create_access_token(subject=user_id, role=role, sid=sid, platform=APP_PLATFORM)
    return RefreshResult(user=user, access_token=access, refresh_token=new_raw, expires_in=app_access_expires_in())


async def logout(db: AsyncSession, raw: str, *, now: datetime | None = None, redis=None) -> None:
    """서버 로그아웃 — 그 sid 리프레시 전부 폐기 + 앱 세션 삭제(sid 같을 때만) + 열린 WS 닫기 알림.
    없는 토큰이면 조용히 끝(존재 여부 노출 안 함)."""
    if not raw:
        return
    now = now or _utcnow()
    row = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
    ).scalar_one_or_none()
    if row is None:
        return
    await _kill_sid(db, redis, row.user_id, row.sid, now)

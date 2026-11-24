"""관리자 계정 저장소 — users(role=ADMIN) 조회·추가, 세션·리프레시 토큰 끊기."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import RefreshToken, User, UserRole, UserSession


async def list_admins(db: AsyncSession) -> list[User]:
    """관리자 목록 — 슈퍼 관리자 먼저, 그다음 만든 순."""
    rows = await db.execute(
        select(User).where(User.role == UserRole.ADMIN).order_by(User.is_super_admin.desc(), User.id)
    )
    return list(rows.scalars())


async def get_by_login_id(db: AsyncSession, login_id: str) -> User | None:
    rows = await db.execute(select(User).where(User.email == login_id))
    return rows.scalar_one_or_none()


async def end_all_sessions(db: AsyncSession, user_id: int, now: datetime) -> list[tuple[str, str]]:
    """그 사용자의 모든 플랫폼 세션 행 삭제 + 리프레시 토큰 폐기(commit 은 호출자). → 끊긴 (platform, sid) 목록."""
    rows = await db.execute(select(UserSession.platform, UserSession.sid).where(UserSession.user_id == user_id))
    ended = [(p, s) for p, s in rows.all()]
    await db.execute(
        delete(UserSession).where(UserSession.user_id == user_id).execution_options(synchronize_session=False)
    )
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    )
    return ended

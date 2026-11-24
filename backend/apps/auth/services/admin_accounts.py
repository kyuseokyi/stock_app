"""관리자 계정 관리 — 슈퍼 관리자의 생성·비활성화·비밀번호 초기화, 모든 관리자의 자기 비밀번호 변경.

규칙
- 관리자는 어드민에서 새 계정(아이디+비밀번호)으로만 만든다. 일반 회원을 관리자로 올리는 길은 없다.
- 슈퍼 관리자 표시(is_super_admin)는 API 로 켜고 끄지 않는다(시드·마이그레이션만).
- 슈퍼 관리자 계정은 이 API 로 비활성화·초기화할 수 없다(자기 자신 포함) — 잠겨서 아무도 못 들어오는 일을 막는다.
- 삭제는 없다: users.comments 가 delete-orphan 이라 지우면 쓴 댓글까지 사라진다 → 비활성화로 대신한다.
- 비밀번호 초기화·비활성화는 그 계정의 로그인을 모두 끊는다. 자기 비밀번호 변경은 지금 로그인은 유지한다.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User, UserRole
from shared.security import hash_password, verify_password
from shared.sessions import publish_session_ended

from ..repositories import admin_accounts_repo as repo


class AdminAccountError(Exception):
    """status·code·message 를 라우터가 그대로 HTTP 오류로 바꾼다."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def list_admins(db: AsyncSession) -> list[User]:
    return await repo.list_admins(db)


async def create_admin(db: AsyncSession, *, login_id: str, nickname: str, password: str) -> User:
    if await repo.get_by_login_id(db, login_id) is not None:
        raise AdminAccountError(409, "LOGIN_ID_TAKEN", "이미 쓰고 있는 아이디예요.")
    user = User(
        email=login_id,
        nickname=nickname.strip(),
        role=UserRole.ADMIN,
        is_active=True,
        is_super_admin=False,
        password_hash=hash_password(password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as e:  # 동시에 같은 아이디로 만든 경우
        await db.rollback()
        raise AdminAccountError(409, "LOGIN_ID_TAKEN", "이미 쓰고 있는 아이디예요.") from e
    await db.refresh(user)
    return user


async def _target(db: AsyncSession, admin_id: int) -> User:
    user = await db.get(User, admin_id)
    if user is None or user.role != UserRole.ADMIN:
        raise AdminAccountError(404, "ADMIN_NOT_FOUND", "관리자 계정을 찾을 수 없어요.")
    if user.is_super_admin:
        raise AdminAccountError(409, "SUPER_ADMIN_LOCKED", "슈퍼 관리자 계정은 여기서 바꿀 수 없어요.")
    return user


async def _end_sessions(db: AsyncSession, redis, user_id: int) -> None:
    ended = await repo.end_all_sessions(db, user_id, _now())
    await db.commit()
    for platform, sid in ended:
        await publish_session_ended(redis, user_id, platform, sid)


async def reset_password(db: AsyncSession, redis, admin_id: int, new_password: str) -> User:
    user = await _target(db, admin_id)
    user.password_hash = hash_password(new_password)
    await _end_sessions(db, redis, user.id)
    await db.refresh(user)
    return user


async def set_active(db: AsyncSession, redis, admin_id: int, is_active: bool) -> User:
    user = await _target(db, admin_id)
    user.is_active = is_active
    if is_active:
        await db.commit()
    else:
        await _end_sessions(db, redis, user.id)
    await db.refresh(user)
    return user


async def change_own_password(db: AsyncSession, user: User, current: str, new: str) -> None:
    if not user.password_hash:  # 소셜·게스트 계정 — 비밀번호가 없다
        raise AdminAccountError(400, "NO_PASSWORD", "비밀번호로 로그인하는 계정이 아니에요.")
    if not verify_password(current, user.password_hash):
        raise AdminAccountError(400, "WRONG_PASSWORD", "현재 비밀번호가 맞지 않아요.")
    if current == new:
        raise AdminAccountError(400, "SAME_PASSWORD", "지금과 다른 비밀번호를 입력해 주세요.")
    user.password_hash = hash_password(new)
    await db.commit()

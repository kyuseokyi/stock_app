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

from shared import admin_permissions
from shared.models import AdminTierPolicy, User, UserRole
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


def _custom_json(keys: list[str]) -> str | None:
    """개별 권한 키 검사 → 저장값. 모르는 키·ADMIN_ROLE_MANAGE 는 422 성격의 오류."""
    bad = [k for k in keys if k not in admin_permissions.GRANTABLE]
    if bad:
        raise AdminAccountError(422, "INVALID_PERMISSION", f"줄 수 없는 권한이에요: {', '.join(bad)}")
    return admin_permissions.dump_keys(keys) if keys else None


async def create_admin(
    db: AsyncSession, *, login_id: str, nickname: str, password: str,
    admin_tier: str = admin_permissions.DEFAULT_TIER, custom_permissions: list[str] | None = None,
) -> User:
    custom = _custom_json(custom_permissions or [])
    if await repo.get_by_login_id(db, login_id) is not None:
        raise AdminAccountError(409, "LOGIN_ID_TAKEN", "이미 쓰고 있는 아이디예요.")
    user = User(
        email=login_id,
        nickname=nickname.strip(),
        role=UserRole.ADMIN,
        is_active=True,
        is_super_admin=False,
        admin_tier=admin_tier,
        custom_permissions=custom,
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


async def set_tier(db: AsyncSession, admin_id: int, admin_tier: str, custom_permissions: list[str]) -> User:
    """관리자 등급·개별 권한 변경 — 다음 요청부터 바로 반영(권한은 요청마다 DB 에서 다시 계산)."""
    custom = _custom_json(custom_permissions)
    user = await _target(db, admin_id)
    user.admin_tier = admin_tier
    user.custom_permissions = custom
    await db.commit()
    await db.refresh(user)
    return user


# --- 등급별 권한 표 ----------------------------------------------------------------------------- #
async def role_policies(db: AsyncSession) -> dict:
    policies = await admin_permissions.load_policies(db)
    return {
        "permissions": [
            {"key": k, "label": label, "description": desc, "grantable": k in admin_permissions.GRANTABLE}
            for k, label, desc in admin_permissions.PERMISSIONS
        ],
        "tiers": [
            {"tier": t, "label": label, "permissions": admin_permissions.ordered(policies.get(t, frozenset()))}
            for t, label in admin_permissions.TIERS
        ],
    }


async def update_tier_policy(db: AsyncSession, tier: str, permissions: list[str]) -> dict:
    if tier not in admin_permissions.TIER_KEYS:
        raise AdminAccountError(404, "TIER_NOT_FOUND", "바꿀 수 없는 등급이에요(슈퍼 관리자는 항상 전체 권한).")
    raw = _custom_json(permissions) or "[]"
    row = await db.get(AdminTierPolicy, tier)
    if row is None:
        db.add(AdminTierPolicy(tier=tier, permissions_json=raw))
    else:
        row.permissions_json = raw
    await db.commit()
    return await role_policies(db)

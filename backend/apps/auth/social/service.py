"""간편 로그인 유스케이스 — 콜백 처리(프로필 → 사용자 → 교환 코드)와 교환 코드 → 사용자.

라우터는 HTTP(리다이렉트·상태코드) 매핑만 하고, 판단은 여기서 한다.
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import AuthProvider, User, UserRole

from .pkce import verifier_matches
from .providers import Provider, ProviderError, ProviderProfile
from .store import SocialStore

logger = logging.getLogger("auth.social")

NICKNAME_MAX = 100
INVALID_CODE_MESSAGE = "로그인 코드가 만료되었거나 이미 사용되었어요. 다시 로그인해 주세요."


class SocialLoginError(Exception):
    """콜백 실패 — code 는 복귀 주소에 ?error= 로 실린다(provider_failed·inactive)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ExchangeError(Exception):
    """교환 실패 — status_code/code/message 로 HTTP 응답(detail = {"code", "message"})."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def normalize_nickname(raw: str | None) -> str:
    """공급자 닉네임 → 앞뒤 공백 제거·최대 100자, 없으면 '유저' + 4자리 난수."""
    nickname = (raw or "").strip()[:NICKNAME_MAX]
    return nickname or f"유저{secrets.randbelow(10000):04d}"


async def find_or_create_user(
    db: AsyncSession, provider: AuthProvider, profile: ProviderProfile
) -> User:
    """(provider, provider_id) 로 찾고 없으면 생성. 기존 사용자 닉네임은 덮어쓰지 않는다.

    이메일로 기존 계정과 병합하지 않으며 공급자 토큰(social_token)도 저장하지 않는다.
    """
    stmt = select(User).where(User.provider == provider, User.provider_id == profile.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user is not None:
        return user

    user = User(
        email=None,
        password_hash=None,
        role=UserRole.FREE,
        is_active=True,
        provider=provider,
        provider_id=profile.id,
        nickname=normalize_nickname(profile.nickname),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # 같은 계정의 동시 첫 로그인 — 유니크 제약에 걸리면 먼저 만들어진 행을 쓴다
        await db.rollback()
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing is None:  # 위반했는데 행도 없음(동시 삭제 등) — 500 대신 로그인 실패로
            logger.warning("social login: integrity fallback found no row (%s)", provider.value)
            raise SocialLoginError("provider_failed")
        return existing
    await db.refresh(user)
    return user


async def complete_social_login(
    *,
    db: AsyncSession,
    store: SocialStore,
    provider: Provider,
    code: str,
    state: str,
    redirect_uri: str,
    cc: str,
    client: str = "web",
) -> str:
    """공급자 code → 프로필 → 사용자 → 일회용 교환 코드(cc 묶음). 실패는 SocialLoginError."""
    try:
        profile = await provider.exchange_code(code=code, state=state, redirect_uri=redirect_uri)
    except ProviderError as exc:
        logger.warning("social login provider failure (%s): %s", provider.name, exc)
        raise SocialLoginError("provider_failed") from exc

    user = await find_or_create_user(db, AuthProvider(provider.name.upper()), profile)
    if not user.is_active:
        raise SocialLoginError("inactive")
    return await store.issue_exchange_code(user.id, cc, client)


async def redeem_exchange_code(
    db: AsyncSession, store: SocialStore, code: str, code_verifier: str | None
) -> tuple[User, str]:
    """교환 코드(1회) + verifier → (활성 사용자, 로그인 플랫폼). 실패는 ExchangeError.

    코드는 GETDEL 로 먼저 소모하므로 verifier 가 틀려도 재시도할 수 없다.
    verifier 불일치는 '없는 코드'와 같은 401 문구(코드 존재 여부를 드러내지 않음).
    """
    grant = await store.consume_exchange_code(code)
    if grant is None or not verifier_matches(code_verifier, grant.cc):
        raise ExchangeError(401, "SOCIAL_CODE_INVALID", INVALID_CODE_MESSAGE)
    user = await db.get(User, grant.user_id)
    if user is None:
        raise ExchangeError(401, "SOCIAL_USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    if not user.is_active:
        raise ExchangeError(403, "SOCIAL_ACCOUNT_INACTIVE", "비활성화된 계정입니다.")
    return user, grant.client

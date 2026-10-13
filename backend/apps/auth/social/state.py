"""OAuth state — 서명 JWT(HS256) {provider, client, app_variant, nonce, exp=10분}.

서버에 세션을 두지 않고도 콜백에서 '누가 시작한 요청인지·어디로 돌려보낼지'를 검증한다.
nonce 1회 사용은 store.use_nonce 가 담당한다(재사용 공격 차단).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt

STATE_TTL_SECONDS = 600
_ALGORITHM = "HS256"
_TYP = "social_state"  # access token 과 섞이지 않게 구분
_CLIENTS = {"web", "app"}
_APP_VARIANTS = {"dev", "prod"}


class StateError(Exception):
    """state 서명·만료·형식·공급자 불일치."""


@dataclass(frozen=True)
class StatePayload:
    provider: str
    client: str
    app_variant: str | None
    nonce: str


def sign_state(
    secret: str,
    *,
    provider: str,
    client: str,
    app_variant: str | None,
    ttl_seconds: int = STATE_TTL_SECONDS,
    now: datetime | None = None,
) -> str:
    issued = now or datetime.now(timezone.utc)
    payload = {
        "typ": _TYP,
        "provider": provider,
        "client": client,
        "app": app_variant,
        "nonce": secrets.token_urlsafe(16),
        "iat": issued,
        "exp": issued + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def verify_state(secret: str, token: str, *, provider: str) -> StatePayload:
    try:
        data = jwt.decode(token, secret, algorithms=[_ALGORITHM], options={"require": ["exp"]})
    except jwt.PyJWTError as exc:
        raise StateError(str(exc)) from exc

    if data.get("typ") != _TYP:
        raise StateError("typ 불일치")
    if data.get("provider") != provider:
        raise StateError("provider 불일치")
    client = data.get("client")
    if client not in _CLIENTS:
        raise StateError("client 값 오류")
    app_variant = data.get("app")
    if client == "app" and app_variant not in _APP_VARIANTS:
        raise StateError("app 값 오류")
    nonce = data.get("nonce")
    if not isinstance(nonce, str) or not nonce:
        raise StateError("nonce 없음")
    return StatePayload(
        provider=provider,
        client=client,
        app_variant=app_variant if client == "app" else None,
        nonce=nonce,
    )

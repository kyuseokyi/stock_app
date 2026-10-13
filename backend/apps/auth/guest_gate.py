"""게스트(닉네임) 로그인 백엔드 게이트 — `AUTH_GUEST_ENABLED`.

- `true`/`false`(및 1/0·yes/no·on/off) 명시 시 그 값.
- 미설정(빈 값)이면 `APP_ENV` 가 명시적으로 development/test 일 때만 켬(그 외·미설정은 끔 — fail closed).
- 알 수 없는 값은 끔(fail closed).
env 는 요청 시점에 읽는다(테스트는 monkeypatch 로 토글).
"""
from __future__ import annotations

import os

from fastapi import HTTPException, status

_TRUE = {"true", "1", "yes", "on"}
_DEFAULT_ON_ENVS = {"development", "test"}


def guest_login_enabled() -> bool:
    raw = (os.getenv("AUTH_GUEST_ENABLED") or "").strip().lower()
    if raw:
        return raw in _TRUE
    return (os.getenv("APP_ENV") or "").strip().lower() in _DEFAULT_ON_ENVS


def require_guest_enabled() -> None:
    """라우트 의존성 — 꺼져 있으면 엔드포인트가 없는 것처럼 404."""
    if not guest_login_enabled():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")

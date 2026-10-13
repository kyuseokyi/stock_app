"""공급자 어댑터 — 카카오·네이버(httpx) + 가짜 공급자(로컬/개발 스모크용).

공통 계약: authorize_url(redirect_uri, state) → 인가 URL,
          exchange_code(code, state, redirect_uri) → ProviderProfile(실패 시 ProviderError).
공급자 토큰은 프로필 조회에만 쓰고 저장하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode

import httpx

from .config import SocialSettings

HTTP_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True)
class ProviderProfile:
    id: str
    nickname: str | None


class ProviderError(Exception):
    """토큰 교환·프로필 조회 실패(비-2xx, 필수 필드 누락, 네트워크 오류)."""


class Provider(Protocol):
    name: str

    def authorize_url(self, *, redirect_uri: str, state: str) -> str: ...

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile: ...


def get_http_transport() -> httpx.AsyncBaseTransport | None:
    """FastAPI 의존성 — 기본 None(실네트워크). 테스트는 httpx.MockTransport 로 override."""
    return None


async def _request_json(
    http: httpx.AsyncClient, method: str, url: str, **kwargs: Any
) -> dict[str, Any]:
    try:
        resp = await http.request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        raise ProviderError(f"{url} 요청 실패: {exc}") from exc
    if not resp.is_success:
        raise ProviderError(f"{url} 응답 {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise ProviderError(f"{url} JSON 아님") from exc
    if not isinstance(body, dict):
        raise ProviderError(f"{url} 응답 형식 오류")
    return body


def _access_token(body: dict[str, Any]) -> str:
    # 네이버는 실패도 HTTP 200 + {"error": ...} 로 줄 수 있다 → access_token 유무로 판정
    token = body.get("access_token")
    if not isinstance(token, str) or not token:
        raise ProviderError(f"access_token 없음: {body.get('error')}")
    return token


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


class KakaoProvider:
    name = "kakao"
    AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize"
    TOKEN_URL = "https://kauth.kakao.com/oauth/token"
    PROFILE_URL = "https://kapi.kakao.com/v2/user/me"

    def __init__(
        self, client_id: str, client_secret: str = "", transport: httpx.AsyncBaseTransport | None = None
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        query = urlencode(
            {"response_type": "code", "client_id": self._client_id, "redirect_uri": redirect_uri, "state": state}
        )
        return f"{self.AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        form = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "code": code,
        }
        if self._client_secret:
            form["client_secret"] = self._client_secret
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, transport=self._transport) as http:
            token = _access_token(await _request_json(http, "POST", self.TOKEN_URL, data=form))
            me = await _request_json(
                http, "GET", self.PROFILE_URL, headers={"Authorization": f"Bearer {token}"}
            )
        user_id = me.get("id")  # 카카오 회원번호는 정수 → 문자열로 저장
        if user_id is None or str(user_id) == "":
            raise ProviderError("카카오 프로필 id 없음")
        profile = _dict(_dict(me.get("kakao_account")).get("profile"))
        properties = _dict(me.get("properties"))
        nickname = _clean(profile.get("nickname")) or _clean(properties.get("nickname"))
        return ProviderProfile(id=str(user_id), nickname=nickname)


class NaverProvider:
    name = "naver"
    AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize"
    TOKEN_URL = "https://nid.naver.com/oauth2.0/token"
    PROFILE_URL = "https://openapi.naver.com/v1/nid/me"

    def __init__(
        self, client_id: str, client_secret: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        query = urlencode(
            {"response_type": "code", "client_id": self._client_id, "redirect_uri": redirect_uri, "state": state}
        )
        return f"{self.AUTHORIZE_URL}?{query}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        form = {
            "grant_type": "authorization_code",
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "code": code,
            "state": state,
        }
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS, transport=self._transport) as http:
            token = _access_token(await _request_json(http, "POST", self.TOKEN_URL, data=form))
            me = await _request_json(
                http, "GET", self.PROFILE_URL, headers={"Authorization": f"Bearer {token}"}
            )
        if me.get("resultcode") not in (None, "00"):
            raise ProviderError(f"네이버 프로필 resultcode={me.get('resultcode')}")
        resp = _dict(me.get("response"))
        user_id = _clean(resp.get("id"))
        if user_id is None:
            raise ProviderError("네이버 프로필 id 없음")
        nickname = _clean(resp.get("nickname")) or _clean(resp.get("name"))
        return ProviderProfile(id=user_id, nickname=nickname)


class FakeProvider:
    """가짜 공급자 — /start 가 자기 콜백으로 code=fake 를 붙여 보낸다(개발·스모크 전용)."""

    def __init__(self, name: str):
        self.name = name

    def authorize_url(self, *, redirect_uri: str, state: str) -> str:
        return f"{redirect_uri}?{urlencode({'code': 'fake', 'state': state})}"

    async def exchange_code(self, *, code: str, state: str, redirect_uri: str) -> ProviderProfile:
        if code != "fake":
            raise ProviderError("가짜 공급자는 code=fake 만 허용")
        return ProviderProfile(id=f"fake-{self.name}-tester", nickname="테스트유저")


def build_provider(
    name: str, settings: SocialSettings, transport: httpx.AsyncBaseTransport | None = None
) -> Provider | None:
    """설정에 맞는 어댑터. 가짜 모드면 FakeProvider, 키가 없으면 None(비활성)."""
    if not settings.is_enabled(name):
        return None
    if settings.fake_mode:
        return FakeProvider(name)
    if name == "kakao":
        return KakaoProvider(settings.kakao_rest_api_key, settings.kakao_client_secret, transport)
    if name == "naver":
        return NaverProvider(settings.naver_client_id, settings.naver_client_secret, transport)
    return None

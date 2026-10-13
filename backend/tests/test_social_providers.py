"""간편 로그인 — 공급자 어댑터(카카오·네이버·가짜) 테스트. 공급자 HTTP 는 httpx.MockTransport."""
from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from apps.auth.social.config import SocialSettings
from apps.auth.social.providers import (
    FakeProvider,
    KakaoProvider,
    NaverProvider,
    ProviderError,
    build_provider,
)

REDIRECT = "http://localhost:8001/api/v1/auth/social/kakao/callback"


def _mock(routes: dict[str, httpx.Response], calls: list[httpx.Request]) -> httpx.MockTransport:
    """host → 고정 응답. 호출된 요청은 calls 에 기록."""

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return routes.get(request.url.host, httpx.Response(404))

    return httpx.MockTransport(handler)


def _form(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


# ---------------------------------------------------------------- kakao
def test_kakao_authorize_url():
    url = KakaoProvider("kakao-key").authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith("https://kauth.kakao.com/oauth/authorize?")
    assert _query(url) == {"response_type": "code", "client_id": "kakao-key", "redirect_uri": REDIRECT, "state": "st"}


async def test_kakao_success_profile_nickname():
    calls: list[httpx.Request] = []
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat", "token_type": "bearer"}),
        "kapi.kakao.com": httpx.Response(200, json={
            "id": 4242,  # 카카오 회원번호는 정수
            "kakao_account": {"profile": {"nickname": "  카카오친구  "}},
            "properties": {"nickname": "옛닉"},
        }),
    }, calls)
    profile = await KakaoProvider("kakao-key", transport=transport).exchange_code(
        code="c1", state="st", redirect_uri=REDIRECT
    )
    assert profile.id == "4242"
    assert profile.nickname == "카카오친구"

    token_req, me_req = calls
    assert token_req.method == "POST" and str(token_req.url) == KakaoProvider.TOKEN_URL
    assert _form(token_req) == {
        "grant_type": "authorization_code", "client_id": "kakao-key", "redirect_uri": REDIRECT, "code": "c1",
    }
    assert me_req.method == "GET" and str(me_req.url) == KakaoProvider.PROFILE_URL
    assert me_req.headers["Authorization"] == "Bearer kat"


async def test_kakao_client_secret_and_properties_fallback():
    calls: list[httpx.Request] = []
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
        "kapi.kakao.com": httpx.Response(200, json={"id": 7, "properties": {"nickname": "프로퍼티닉"}}),
    }, calls)
    profile = await KakaoProvider("kakao-key", "kakao-secret", transport).exchange_code(
        code="c1", state="st", redirect_uri=REDIRECT
    )
    assert profile.nickname == "프로퍼티닉"
    assert _form(calls[0])["client_secret"] == "kakao-secret"


async def test_kakao_no_nickname_is_none():
    transport = _mock({
        "kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
        "kapi.kakao.com": httpx.Response(200, json={"id": 7, "kakao_account": {}}),
    }, [])
    profile = await KakaoProvider("k", transport=transport).exchange_code(code="c", state="s", redirect_uri=REDIRECT)
    assert (profile.id, profile.nickname) == ("7", None)


@pytest.mark.parametrize("routes", [
    {"kauth.kakao.com": httpx.Response(401, json={"error": "invalid_client"})},
    {"kauth.kakao.com": httpx.Response(200, json={"error": "invalid_grant"})},
    {"kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
     "kapi.kakao.com": httpx.Response(500, text="boom")},
    {"kauth.kakao.com": httpx.Response(200, json={"access_token": "kat"}),
     "kapi.kakao.com": httpx.Response(200, json={"kakao_account": {}})},  # id 누락
    {"kauth.kakao.com": httpx.Response(200, text="not json")},
])
async def test_kakao_failures_raise_provider_error(routes):
    with pytest.raises(ProviderError):
        await KakaoProvider("k", transport=_mock(routes, [])).exchange_code(code="c", state="s", redirect_uri=REDIRECT)


async def test_network_error_raises_provider_error():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=request)

    with pytest.raises(ProviderError):
        await KakaoProvider("k", transport=httpx.MockTransport(boom)).exchange_code(
            code="c", state="s", redirect_uri=REDIRECT
        )


# ---------------------------------------------------------------- naver
def test_naver_authorize_url():
    url = NaverProvider("nid", "nsecret").authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith("https://nid.naver.com/oauth2.0/authorize?")
    assert _query(url) == {"response_type": "code", "client_id": "nid", "redirect_uri": REDIRECT, "state": "st"}


async def test_naver_success_and_form():
    calls: list[httpx.Request] = []
    transport = _mock({
        "nid.naver.com": httpx.Response(200, json={"access_token": "nat", "token_type": "bearer"}),
        "openapi.naver.com": httpx.Response(200, json={
            "resultcode": "00", "message": "success",
            "response": {"id": "naver-abc", "nickname": "네이버친구", "name": "홍길동"},
        }),
    }, calls)
    profile = await NaverProvider("nid", "nsecret", transport).exchange_code(code="c1", state="st", redirect_uri=REDIRECT)
    assert profile.id == "naver-abc"
    assert profile.nickname == "네이버친구"
    assert _form(calls[0]) == {
        "grant_type": "authorization_code", "client_id": "nid", "client_secret": "nsecret", "code": "c1", "state": "st",
    }
    assert calls[1].headers["Authorization"] == "Bearer nat"


async def test_naver_name_fallback():
    transport = _mock({
        "nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
        "openapi.naver.com": httpx.Response(200, json={"resultcode": "00", "response": {"id": "n1", "name": "홍길동"}}),
    }, [])
    profile = await NaverProvider("nid", "ns", transport).exchange_code(code="c", state="s", redirect_uri=REDIRECT)
    assert profile.nickname == "홍길동"


@pytest.mark.parametrize("routes", [
    # 네이버는 토큰 실패를 HTTP 200 + error 로 돌려줄 수 있다
    {"nid.naver.com": httpx.Response(200, json={"error": "invalid_request", "error_description": "no code"})},
    {"nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
     "openapi.naver.com": httpx.Response(200, json={"resultcode": "024", "message": "Authentication failed"})},
    {"nid.naver.com": httpx.Response(200, json={"access_token": "nat"}),
     "openapi.naver.com": httpx.Response(200, json={"resultcode": "00", "response": {"nickname": "id없음"}})},
    {"nid.naver.com": httpx.Response(503, text="down")},
])
async def test_naver_failures_raise_provider_error(routes):
    with pytest.raises(ProviderError):
        await NaverProvider("nid", "ns", _mock(routes, [])).exchange_code(code="c", state="s", redirect_uri=REDIRECT)


# ---------------------------------------------------------------- fake + factory
async def test_fake_provider():
    fake = FakeProvider("kakao")
    url = fake.authorize_url(redirect_uri=REDIRECT, state="st")
    assert url.startswith(REDIRECT + "?")
    assert _query(url) == {"code": "fake", "state": "st"}
    profile = await fake.exchange_code(code="fake", state="st", redirect_uri=REDIRECT)
    assert (profile.id, profile.nickname) == ("fake-kakao-tester", "테스트유저")
    with pytest.raises(ProviderError):
        await fake.exchange_code(code="real", state="st", redirect_uri=REDIRECT)


def test_build_provider():
    assert build_provider("kakao", SocialSettings()) is None
    assert isinstance(build_provider("kakao", SocialSettings(kakao_rest_api_key="k")), KakaoProvider)
    assert isinstance(build_provider("naver", SocialSettings(naver_client_id="i", naver_client_secret="s")), NaverProvider)
    fake = SocialSettings(app_env="development", kakao_rest_api_key="k", fake_provider_requested=True)
    assert isinstance(build_provider("kakao", fake), FakeProvider)  # 가짜 모드가 실키보다 우선
    prod = SocialSettings(app_env="production", fake_provider_requested=True)
    assert build_provider("kakao", prod) is None

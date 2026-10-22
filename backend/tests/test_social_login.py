"""간편 로그인 — auth API(providers/start/callback/exchange) 통합 테스트.

DB 는 sqlite in-memory, Redis 는 fakeredis, 공급자 HTTP 는 httpx.MockTransport.
설정·저장소·전송은 dependency_overrides 로 주입한다(실 env·Redis·네트워크 미사용).
"""
from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import replace
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.main import app
from apps.auth.social.config import SocialSettings, get_social_settings
from apps.auth.social.providers import get_http_transport
from apps.auth.social import service as social_service
from apps.auth.social.providers import ProviderProfile
from apps.auth.social.service import SocialLoginError, find_or_create_user, normalize_nickname
from apps.auth.social.state import sign_state, verify_state
from apps.auth.social.store import SocialStore, get_social_store
from shared.database import get_db
from shared.models import AuthProvider, Base, User
from shared.security import decode_token

SECRET = "test-state-secret-0123456789abcdef"
BASE = "/api/v1/auth/social"
WEB_RETURN = "http://localhost:3000/auth/complete"
VERIFIER = "dBjftJeZ4CVP-mJ0z9-iFGc8Ld2ZRY0kbtiYn3sV1mA"
CC = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()
KEYED = SocialSettings(
    kakao_rest_api_key="kakao-key",
    naver_client_id="nid",
    naver_client_secret="nsecret",
    state_secret=SECRET,
)


@pytest.fixture
async def maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def ctx(maker):
    """ctx.client(ASGI) + 바꿔 끼울 수 있는 ctx.settings / ctx.transport + ctx.store(fakeredis)."""
    state = SimpleNamespace(
        settings=KEYED,
        transport=None,
        store=SocialStore(fake_aioredis.FakeRedis(decode_responses=True)),
        maker=maker,
    )

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_social_settings] = lambda: state.settings
    app.dependency_overrides[get_social_store] = lambda: state.store
    app.dependency_overrides[get_http_transport] = lambda: state.transport
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        state.client = client
        yield state
    app.dependency_overrides.clear()


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def _kakao(user_id: int = 4242, nickname: str | None = "카카오친구", token_status: int = 200) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "kauth.kakao.com":
            if token_status != 200:
                return httpx.Response(token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "kat"})
        if request.url.host == "kapi.kakao.com":
            profile = {"nickname": nickname} if nickname is not None else {}
            return httpx.Response(200, json={"id": user_id, "kakao_account": {"profile": profile}})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def _start(ctx, provider: str = "kakao", **params: str) -> str:
    """/start → 302 → 공급자 인가 URL 의 state 반환."""
    r = await ctx.client.get(f"{BASE}/{provider}/start", params={"client": "web", "cc": CC, **params})
    assert r.status_code == 302, r.text
    return _query(r.headers["location"])["state"]


async def _exchange(ctx, code: str, verifier: str | None = VERIFIER) -> httpx.Response:
    body = {"code": code} | ({"code_verifier": verifier} if verifier is not None else {})
    return await ctx.client.post(f"{BASE}/exchange", json=body)


async def _callback(ctx, provider: str = "kakao", **params: str) -> httpx.Response:
    return await ctx.client.get(f"{BASE}/{provider}/callback", params=params)


async def _login(ctx, **start_params: str) -> tuple[str, dict[str, str]]:
    """start → callback 까지. (복귀 Location, 쿼리) 반환."""
    state = await _start(ctx, **start_params)
    r = await _callback(ctx, code="c1", state=state)
    assert r.status_code == 302, r.text
    return r.headers["location"], _query(r.headers["location"])


async def _users(ctx) -> list[User]:
    async with ctx.maker() as s:
        return list((await s.execute(select(User).order_by(User.id))).scalars())


# ---------------------------------------------------------------- providers / start
async def test_providers_endpoint(ctx):
    r = await ctx.client.get(f"{BASE}/providers")
    assert r.status_code == 200
    assert r.json() == {"kakao": True, "naver": True}

    ctx.settings = SocialSettings(state_secret=SECRET)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": False, "naver": False}


async def test_start_redirects_to_kakao_authorize(ctx):
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web", "cc": CC})
    assert r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://kauth.kakao.com/oauth/authorize?")
    q = _query(loc)
    assert q["client_id"] == "kakao-key"
    assert q["redirect_uri"] == "http://localhost:8001/api/v1/auth/social/kakao/callback"
    assert q["response_type"] == "code" and q["state"]


async def test_start_redirects_to_naver_authorize(ctx):
    r = await ctx.client.get(f"{BASE}/naver/start", params={"client": "app", "app": "dev", "cc": CC})
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://nid.naver.com/oauth2.0/authorize?")


async def test_start_disabled_provider_503(ctx):
    ctx.settings = SocialSettings(state_secret=SECRET)
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web", "cc": CC})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "PROVIDER_DISABLED"


async def test_start_validation(ctx):
    assert (await ctx.client.get(f"{BASE}/apple/start", params={"client": "web", "cc": CC})).status_code == 422
    assert (await ctx.client.get(f"{BASE}/kakao/start", params={"client": "desktop", "cc": CC})).status_code == 422
    assert (await ctx.client.get(f"{BASE}/kakao/start", params={"cc": CC})).status_code == 422  # client 필수
    assert (await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web"})).status_code == 422  # cc 필수
    for bad in ("short", CC + "A", CC[:-1] + "+", CC[:-1] + "="):
        r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web", "cc": bad})
        assert r.status_code == 422, bad


# ---------------------------------------------------------------- callback 성공 + exchange
async def test_callback_creates_user_and_exchange_issues_token(ctx):
    ctx.transport = _kakao(user_id=4242, nickname="카카오친구")
    loc, q = await _login(ctx)
    assert loc.startswith(WEB_RETURN + "?")
    assert set(q) == {"code"}

    users = await _users(ctx)
    assert len(users) == 1
    u = users[0]
    assert (u.provider, u.provider_id, u.nickname) == (AuthProvider.KAKAO, "4242", "카카오친구")
    assert u.email is None and u.password_hash is None and u.social_token is None
    assert u.role.value == "FREE" and u.is_active is True

    r = await _exchange(ctx, q["code"])
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"] == {"id": u.id, "email": None, "nickname": "카카오친구", "role": "FREE"}
    assert decode_token(body["access_token"])["sub"] == str(u.id)


async def test_relogin_returns_same_user_without_overwriting_nickname(ctx):
    ctx.transport = _kakao(user_id=4242, nickname="처음닉")
    await _login(ctx)
    ctx.transport = _kakao(user_id=4242, nickname="바뀐닉")
    _, q = await _login(ctx)

    users = await _users(ctx)
    assert len(users) == 1
    assert users[0].nickname == "처음닉"
    r = await _exchange(ctx, q["code"])
    assert r.json()["user"]["id"] == users[0].id


async def test_same_id_on_other_provider_is_other_user(ctx):
    ctx.transport = _kakao(user_id=1)
    await _login(ctx)

    def naver(request: httpx.Request) -> httpx.Response:
        if request.url.host == "nid.naver.com":
            return httpx.Response(200, json={"access_token": "nat"})
        return httpx.Response(200, json={"resultcode": "00", "response": {"id": "1", "nickname": "네이버"}})

    ctx.transport = httpx.MockTransport(naver)
    state = await _start(ctx, provider="naver")
    r = await _callback(ctx, provider="naver", code="c", state=state)
    assert "code" in _query(r.headers["location"])
    assert [(u.provider, u.provider_id) for u in await _users(ctx)] == [
        (AuthProvider.KAKAO, "1"), (AuthProvider.NAVER, "1"),
    ]


async def test_nickname_fallback_when_provider_has_none(ctx):
    ctx.transport = _kakao(nickname=None)
    await _login(ctx)
    assert re.fullmatch(r"유저\d{4}", (await _users(ctx))[0].nickname)


def test_normalize_nickname():
    assert normalize_nickname("  닉  ") == "닉"
    assert len(normalize_nickname("가" * 150)) == 100
    assert re.fullmatch(r"유저\d{4}", normalize_nickname("   "))


# ---------------------------------------------------------------- callback 실패
async def test_provider_failure_redirects_provider_failed(ctx):
    ctx.transport = _kakao(token_status=500)
    _, q = await _login(ctx)
    assert q == {"error": "provider_failed"}
    assert await _users(ctx) == []


async def test_provider_cancel_redirects_cancelled(ctx):
    state = await _start(ctx)
    r = await _callback(ctx, error="access_denied", error_description="User denied access", state=state)
    assert r.status_code == 302
    assert _query(r.headers["location"]) == {"error": "cancelled"}

    state = await _start(ctx)
    r = await _callback(ctx, error="server_error", state=state)
    assert _query(r.headers["location"]) == {"error": "provider_failed"}


async def test_missing_code_is_provider_failed(ctx):
    state = await _start(ctx)
    r = await _callback(ctx, state=state)
    assert _query(r.headers["location"]) == {"error": "provider_failed"}


async def test_nonce_reuse_redirects_state_invalid(ctx):
    ctx.transport = _kakao()
    state = await _start(ctx)
    first = await _callback(ctx, code="c1", state=state)
    assert "code" in _query(first.headers["location"])
    replay = await _callback(ctx, code="c1", state=state)
    assert replay.status_code == 302
    assert _query(replay.headers["location"]) == {"error": "state_invalid"}


@pytest.mark.parametrize("make_state", [
    lambda: None,  # state 없음
    lambda: "garbage",
    lambda: sign_state("attacker-secret-0123456789abcdef", provider="kakao", client="web", app_variant=None, cc=CC),
    lambda: sign_state(SECRET, provider="naver", client="web", app_variant=None, cc=CC),  # provider 불일치
    lambda: sign_state(SECRET, provider="kakao", client="web", app_variant=None, cc=CC, ttl_seconds=-1),  # 만료
])
async def test_invalid_state_returns_400_html_without_redirect(ctx, make_state):
    state = make_state()
    params = {"code": "c1"} | ({"state": state} if state else {})
    r = await _callback(ctx, **params)
    assert r.status_code == 400
    assert "location" not in r.headers
    assert r.headers["content-type"].startswith("text/html")


async def test_inactive_user_redirects_inactive(ctx):
    async with ctx.maker() as s:
        s.add(User(provider=AuthProvider.KAKAO, provider_id="4242", nickname="정지", is_active=False))
        await s.commit()
    ctx.transport = _kakao(user_id=4242)
    _, q = await _login(ctx)
    assert q == {"error": "inactive"}


# ---------------------------------------------------------------- 복귀 주소 선택
@pytest.mark.parametrize("params, prefix", [
    ({"client": "web"}, WEB_RETURN + "?"),
    ({"client": "app", "app": "dev"}, "stockapp-dev://auth?"),
    ({"client": "app", "app": "prod"}, "stockapp://auth?"),
    ({"client": "app"}, "stockapp://auth?"),  # app 미지정 → prod
])
async def test_return_url_by_client(ctx, params, prefix):
    ctx.transport = _kakao()
    loc, q = await _login(ctx, **params)
    assert loc.startswith(prefix)
    assert "code" in q


async def test_return_url_comes_from_settings(ctx):
    ctx.settings = replace(KEYED, web_return_url="https://app.example.com/auth/complete")
    ctx.transport = _kakao()
    loc, _ = await _login(ctx)
    assert loc.startswith("https://app.example.com/auth/complete?code=")


# ---------------------------------------------------------------- exchange
async def test_exchange_code_is_single_use(ctx):
    ctx.transport = _kakao()
    _, q = await _login(ctx)
    assert (await _exchange(ctx, q["code"])).status_code == 200
    again = await _exchange(ctx, q["code"])
    assert again.status_code == 401


async def test_exchange_unknown_code_401(ctx):
    r = await _exchange(ctx, "nope")
    assert r.status_code == 401
    assert (await ctx.client.post(f"{BASE}/exchange", json={"code": ""})).status_code == 422


async def test_exchange_inactive_user_403(ctx):
    async with ctx.maker() as s:
        user = User(provider=AuthProvider.KAKAO, provider_id="9", nickname="정지", is_active=False)
        s.add(user)
        await s.commit()
        user_id = user.id
    code = await ctx.store.issue_exchange_code(user_id, CC)
    r = await _exchange(ctx, code)
    assert r.status_code == 403


async def test_start_state_carries_cc(ctx):
    state = await _start(ctx)
    assert verify_state(SECRET, state, provider="kakao").cc == CC


@pytest.mark.parametrize("verifier", [None, "", "wrong-verifier", VERIFIER + "x", "가나다라"])
async def test_exchange_wrong_or_missing_verifier_401_and_code_consumed(ctx, verifier):
    ctx.transport = _kakao()
    _, q = await _login(ctx)
    bad = await _exchange(ctx, q["code"], verifier=verifier)
    assert bad.status_code == 401
    unknown = await _exchange(ctx, "nope")
    assert bad.json()["detail"] == unknown.json()["detail"]  # 같은 문구(코드 존재 여부 노출 금지)
    assert bad.json()["detail"]["code"] == "SOCIAL_CODE_INVALID" and bad.json()["detail"]["message"]
    # 실패해도 코드는 소모 — 이어서 올바른 verifier 로도 교환 불가
    assert (await _exchange(ctx, q["code"])).status_code == 401


async def test_exchange_correct_verifier_200(ctx):
    ctx.transport = _kakao()
    _, q = await _login(ctx)
    assert (await _exchange(ctx, q["code"])).status_code == 200


async def test_exchange_verifier_too_long_422(ctx):
    assert (await _exchange(ctx, "c", verifier="a" * 129)).status_code == 422


# ---------------------------------------------------------------- 저장소·DB 장애 → provider_failed
class _BrokenStore(SocialStore):
    def __init__(self, fail: str):
        super().__init__(fake_aioredis.FakeRedis(decode_responses=True))
        self._fail = fail

    async def use_nonce(self, nonce: str) -> bool:
        if self._fail == "nonce":
            raise RedisConnectionError("redis down")
        return await super().use_nonce(nonce)

    async def issue_exchange_code(self, user_id: int, cc: str, client: str = "web") -> str:
        raise RedisConnectionError("redis down")


@pytest.mark.parametrize("fail", ["nonce", "issue"])
async def test_callback_redis_failure_redirects_provider_failed(ctx, fail):
    ctx.transport = _kakao()
    ctx.store = _BrokenStore(fail)
    loc, q = await _login(ctx)
    assert loc.startswith(WEB_RETURN + "?")
    assert q == {"error": "provider_failed"}


async def test_callback_db_failure_redirects_provider_failed(ctx, monkeypatch):
    async def boom(*args, **kwargs):
        raise OperationalError("SELECT secret", {"p": "secret"}, Exception("db down"))

    monkeypatch.setattr(social_service, "find_or_create_user", boom)
    ctx.transport = _kakao()
    _, q = await _login(ctx)
    assert q == {"error": "provider_failed"}


class _RaceSession:
    """첫 커밋은 유니크 위반, 재조회도 행 없음(드문 경합·삭제) — scalar_one 대신 None 처리 확인."""

    def __init__(self):
        self.rolled_back = False

    async def execute(self, stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def add(self, obj):
        pass

    async def commit(self):
        raise IntegrityError("INSERT", {}, Exception("unique"))

    async def rollback(self):
        self.rolled_back = True


async def test_find_or_create_integrity_fallback_missing_row_raises_provider_failed():
    db = _RaceSession()
    with pytest.raises(SocialLoginError) as exc:
        await find_or_create_user(db, AuthProvider.KAKAO, ProviderProfile(id="1", nickname="n"))
    assert exc.value.code == "provider_failed"
    assert db.rolled_back


# ---------------------------------------------------------------- 가짜 공급자 모드
async def test_fake_mode_full_flow(ctx):
    ctx.settings = SocialSettings(app_env="test", state_secret=SECRET, fake_provider_requested=True)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": True, "naver": True}

    r = await ctx.client.get(f"{BASE}/naver/start", params={"client": "web", "cc": CC})
    assert r.status_code == 302
    loc = urlsplit(r.headers["location"])
    assert loc.path == f"{BASE}/naver/callback"  # 공급자 대신 자기 콜백
    assert _query(r.headers["location"])["code"] == "fake"

    cb = await ctx.client.get(f"{loc.path}?{loc.query}")
    code = _query(cb.headers["location"])["code"]
    assert (await _exchange(ctx, code, verifier="wrong-verifier")).status_code == 401  # 가짜 모드도 검증
    r = await ctx.client.get(f"{BASE}/naver/start", params={"client": "web", "cc": CC})
    loc = urlsplit(r.headers["location"])
    cb = await ctx.client.get(f"{loc.path}?{loc.query}")
    code = _query(cb.headers["location"])["code"]
    body = (await _exchange(ctx, code)).json()
    assert body["user"]["nickname"] == "테스트유저"
    u = (await _users(ctx))[0]
    assert (u.provider, u.provider_id) == (AuthProvider.NAVER, "fake-naver-tester")


async def test_fake_mode_ignored_without_explicit_env(ctx):
    ctx.settings = SocialSettings(state_secret=SECRET, fake_provider_requested=True)  # app_env 미지정
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": False, "naver": False}


async def test_fake_mode_ignored_in_production(ctx):
    ctx.settings = SocialSettings(app_env="production", state_secret=SECRET, fake_provider_requested=True)
    assert (await ctx.client.get(f"{BASE}/providers")).json() == {"kakao": False, "naver": False}
    r = await ctx.client.get(f"{BASE}/kakao/start", params={"client": "web", "cc": CC})
    assert r.status_code == 503


# ---------------------------------------------------------------- 회귀: 기존 엔드포인트
async def test_guest_login_unchanged(ctx, monkeypatch):
    monkeypatch.setenv("AUTH_GUEST_ENABLED", "true")  # 로컬 .env.development(APP_ENV)에 기대지 않게 명시
    r = await ctx.client.post("/api/v1/auth/guest", json={"nickname": "주린이"})
    assert r.status_code == 200
    assert r.json()["user"]["nickname"] == "주린이"
    assert r.json()["user"]["email"].endswith("@guest.local")

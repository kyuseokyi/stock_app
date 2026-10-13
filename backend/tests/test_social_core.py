"""간편 로그인 — 설정(SocialSettings)·state 서명·Redis 저장소 테스트."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fakeredis import aioredis as fake_aioredis

from apps.auth.social.config import SocialSettings, load_social_settings, startup_warnings
from apps.auth.social.state import StateError, sign_state, verify_state
from apps.auth.social.store import SocialStore
from shared import security

SOCIAL_ENV_KEYS = (
    "APP_ENV", "KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET",
    "SOCIAL_STATE_SECRET", "SOCIAL_REDIRECT_BASE", "SOCIAL_WEB_RETURN_URL",
    "SOCIAL_APP_RETURN_URL_PROD", "SOCIAL_APP_RETURN_URL_DEV", "SOCIAL_FAKE_PROVIDER",
)
SECRET = "test-state-secret-0123456789abcdef"


@pytest.fixture
def clean_env(monkeypatch):
    for key in SOCIAL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


# ---------------------------------------------------------------- settings
def test_settings_defaults_and_kakao_key(clean_env):
    clean_env.setenv("KAKAO_REST_API_KEY", "kakao-key")
    s = load_social_settings()
    assert s.is_enabled("kakao") is True
    assert s.is_enabled("naver") is False
    assert s.is_enabled("apple") is False
    assert s.redirect_uri("kakao") == "http://localhost:8001/api/v1/auth/social/kakao/callback"
    assert s.return_url("web", None) == "http://localhost:3000/auth/complete"
    assert s.return_url("app", "prod") == "stockapp://auth"
    assert s.return_url("app", "dev") == "stockapp-dev://auth"


def test_settings_read_at_call_time(clean_env):
    assert load_social_settings().is_enabled("naver") is False
    clean_env.setenv("NAVER_CLIENT_ID", "nid")
    assert load_social_settings().is_enabled("naver") is False  # secret 없으면 비활성
    clean_env.setenv("NAVER_CLIENT_SECRET", "nsecret")
    clean_env.setenv("SOCIAL_REDIRECT_BASE", "https://auth.example.com/api/v1/auth/social/")
    s = load_social_settings()
    assert s.is_enabled("naver") is True
    assert s.redirect_uri("naver") == "https://auth.example.com/api/v1/auth/social/naver/callback"


def test_fake_mode_enables_all_but_is_ignored_in_production(clean_env):
    clean_env.setenv("SOCIAL_FAKE_PROVIDER", "true")
    dev = load_social_settings()
    assert dev.fake_mode is True
    assert dev.is_enabled("kakao") and dev.is_enabled("naver")

    clean_env.setenv("APP_ENV", "production")
    prod = load_social_settings()
    assert prod.fake_mode is False
    assert prod.is_enabled("kakao") is False


def test_state_secret_falls_back_to_jwt_key():
    assert SocialSettings().effective_state_secret == security.SECRET_KEY
    assert SocialSettings(state_secret="own").effective_state_secret == "own"


def test_startup_warnings():
    assert startup_warnings(SocialSettings(fake_provider_requested=True)) == []
    warns = startup_warnings(SocialSettings(app_env="production", fake_provider_requested=True))
    assert len(warns) == 2  # 가짜 모드 무시 + state 키 폴백
    assert startup_warnings(SocialSettings(app_env="production", state_secret="x")) == []


# ---------------------------------------------------------------- state
def test_state_roundtrip_web_and_app():
    web = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    assert (web.provider, web.client, web.app_variant) == ("kakao", "web", None)
    assert web.nonce

    app = verify_state(SECRET, sign_state(SECRET, provider="naver", client="app", app_variant="dev"), provider="naver")
    assert (app.client, app.app_variant) == ("app", "dev")


def test_state_nonce_differs_per_sign():
    a = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    b = verify_state(SECRET, sign_state(SECRET, provider="kakao", client="web", app_variant=None), provider="kakao")
    assert a.nonce != b.nonce


def test_state_expired():
    past = datetime.now(timezone.utc) - timedelta(minutes=11)
    token = sign_state(SECRET, provider="kakao", client="web", app_variant=None, now=past)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="kakao")


def test_state_forged_with_other_secret():
    token = sign_state("attacker-secret-0123456789abcdef", provider="kakao", client="web", app_variant=None)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="kakao")


def test_state_provider_mismatch():
    token = sign_state(SECRET, provider="kakao", client="web", app_variant=None)
    with pytest.raises(StateError):
        verify_state(SECRET, token, provider="naver")


def test_state_garbage_and_access_token_rejected():
    with pytest.raises(StateError):
        verify_state(SECRET, "not-a-jwt", provider="kakao")
    access = security.create_access_token(subject=1, role="FREE")  # typ 없음
    with pytest.raises(StateError):
        verify_state(security.SECRET_KEY, access, provider="kakao")


# ---------------------------------------------------------------- store
@pytest.fixture
def store():
    return SocialStore(fake_aioredis.FakeRedis(decode_responses=True))


async def test_nonce_single_use(store):
    assert await store.use_nonce("n1") is True
    assert await store.use_nonce("n1") is False
    assert await store.use_nonce("n2") is True


async def test_exchange_code_single_use_with_ttl(store):
    code = await store.issue_exchange_code(42)
    assert 0 < await store._redis.ttl(f"auth:social:code:{code}") <= 60
    assert await store.consume_exchange_code(code) == 42
    assert await store.consume_exchange_code(code) is None


async def test_unknown_exchange_code(store):
    assert await store.consume_exchange_code("nope") is None

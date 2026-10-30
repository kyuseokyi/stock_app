"""AI 시황 분석 설정 getter·클라이언트 팩토리 — 키가 없으면 None."""
from __future__ import annotations

import pytest

from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.clients.naver_news import get_naver_news_client
from apps.ai_analyst.clients.opendart import get_opendart_client
from shared import config
from shared.env import FILE_ENV_KEYS

_KEYS = ("GEMINI_API_KEY", "GEMINI_MODEL", "NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET",
         "OPENDART_API_KEY", "KRX_ID", "KRX_PW")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in _KEYS:
        monkeypatch.delenv(k, raising=False)


def test_getters_none_without_keys():
    assert config.gemini_api_key() is None
    assert config.naver_search_client_id() is None
    assert config.naver_search_client_secret() is None
    assert config.opendart_api_key() is None
    assert config.krx_credentials() is None
    assert config.gemini_model() == config.DEFAULT_GEMINI_MODEL == "gemini-3.8-flash"


def test_blank_values_are_none(monkeypatch):
    for k in _KEYS:
        monkeypatch.setenv(k, "   ")
    assert config.gemini_api_key() is None
    assert config.opendart_api_key() is None
    assert config.krx_credentials() is None
    assert config.gemini_model() == "gemini-3.8-flash"


def test_getters_read_env(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-x")
    monkeypatch.setenv("KRX_ID", "id")
    assert config.gemini_model() == "gemini-x"
    assert config.krx_credentials() is None  # 비밀번호 없으면 None
    monkeypatch.setenv("KRX_PW", "pw")
    assert config.krx_credentials() == ("id", "pw")


def test_naver_search_does_not_use_login_keys(monkeypatch):
    monkeypatch.setenv("NAVER_CLIENT_ID", "login-id")
    monkeypatch.setenv("NAVER_CLIENT_SECRET", "login-secret")
    assert config.naver_search_client_id() is None
    assert get_naver_news_client() is None


def test_factories_none_without_keys():
    assert get_gemini_client() is None
    assert get_naver_news_client() is None
    assert get_opendart_client() is None


def test_factories_with_keys(monkeypatch):
    monkeypatch.setenv("NAVER_SEARCH_CLIENT_ID", "a")
    monkeypatch.setenv("NAVER_SEARCH_CLIENT_SECRET", "b")
    monkeypatch.setenv("OPENDART_API_KEY", "c")
    assert get_naver_news_client() is not None
    assert get_opendart_client() is not None


def test_file_env_keys_include_new_secrets():
    for k in ("GEMINI_API_KEY", "NAVER_SEARCH_CLIENT_SECRET", "OPENDART_API_KEY", "KRX_PW"):
        assert k in FILE_ENV_KEYS

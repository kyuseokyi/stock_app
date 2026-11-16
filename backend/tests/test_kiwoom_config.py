"""shared.kiwoom_config — 키움 REST 설정(실전 키만, 모의 분기 없음)."""

from __future__ import annotations

import pytest

from shared.kiwoom_config import KiwoomConfig, get_kiwoom_config


@pytest.fixture
def _clean_env(monkeypatch):
    for k in ("KIWOOM_APP_KEY", "KIWOOM_APP_SECRET", "KIWOOM_RATE_PER_SEC"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_default_rate_is_4_and_not_configured(_clean_env):
    cfg = get_kiwoom_config()
    assert cfg.rate_per_sec == 4
    assert cfg.is_configured is False


def test_urls_are_real_domain_only():
    cfg = KiwoomConfig(app_key="k", app_secret="s", rate_per_sec=4)
    assert cfg.base_url == "https://api.kiwoom.com"
    assert cfg.ws_url == "wss://api.kiwoom.com:10000"


@pytest.mark.parametrize("raw,expected", [("10", 5), ("0", 1), ("-3", 1), ("3", 3), ("abc", 4), ("", 4), ("4.9", 4)])
def test_rate_is_clamped_to_1_5(_clean_env, raw, expected):
    _clean_env.setenv("KIWOOM_RATE_PER_SEC", raw)
    assert get_kiwoom_config().rate_per_sec == expected


def test_configured_only_with_both_key_and_secret(_clean_env):
    _clean_env.setenv("KIWOOM_APP_KEY", "key")
    assert get_kiwoom_config().is_configured is False
    _clean_env.setenv("KIWOOM_APP_SECRET", "secret")
    assert get_kiwoom_config().is_configured is True


def test_whitespace_only_key_is_not_configured(_clean_env):
    _clean_env.setenv("KIWOOM_APP_KEY", "   ")
    _clean_env.setenv("KIWOOM_APP_SECRET", "secret")
    assert get_kiwoom_config().is_configured is False

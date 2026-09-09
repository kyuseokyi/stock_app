"""shared.cors.build_allowed_origins 회귀 테스트.

admin.haezean.com CORS 차단 사건 재발 방지: develop 배포 도메인이 코드에 포함되고,
CORS_ORIGINS env 로 확장되며, 중복이 제거되는지 확인한다.
"""

from __future__ import annotations

import importlib

import shared.cors as cors


def _reload_with_env(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
    else:
        monkeypatch.setenv("CORS_ORIGINS", value)
    importlib.reload(cors)
    return cors.build_allowed_origins()


def test_includes_local_and_develop_origins(monkeypatch):
    origins = _reload_with_env(monkeypatch, None)
    # 로컬 dev(Vite)
    assert "http://localhost:5173" in origins
    # develop 배포(미니PC) — 코드 포함이라 env 없이도 허용(green-but-broken 방지)
    assert "https://admin.haezean.com" in origins
    assert "https://app.haezean.com" in origins


def test_env_extends_origins(monkeypatch):
    origins = _reload_with_env(monkeypatch, "https://prod.example.com")
    assert "https://prod.example.com" in origins
    # 기존 develop 도메인도 유지
    assert "https://admin.haezean.com" in origins


def test_dedup_preserves_single_entry(monkeypatch):
    # env 로 이미 코드에 있는 도메인을 또 줘도 중복되지 않아야
    origins = _reload_with_env(monkeypatch, "https://admin.haezean.com, https://prod.example.com")
    assert origins.count("https://admin.haezean.com") == 1
    assert "https://prod.example.com" in origins


def test_blank_env_entries_ignored(monkeypatch):
    origins = _reload_with_env(monkeypatch, " , ,https://ok.example.com, ")
    assert "https://ok.example.com" in origins
    assert "" not in origins

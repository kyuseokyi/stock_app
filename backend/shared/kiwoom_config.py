"""키움증권 REST API 접속 설정.

KIS(`shared/kis_config.py`)와 같은 모양. 키움은 **실전 키만** 쓰므로 모의(mock) 분기가 없다.
키움은 상용 서버 IP 만 화이트리스트에 등록돼 있어 실제 호출은 상용 서버에서만 가능하다.
키·시크릿이 없으면 꺼진 것으로 본다(`is_configured=False`) — 개발 서버 동작은 그대로.

공식 명세: GitHub Kiwoom-Securities/Kiwoom-REST-API `kiwoom/_data/kiwoom_api_spec.json`(c7a3d25)
설계: docs/superpowers/specs/2026-11-16-kiwoom-client-probe-design.md
"""

from __future__ import annotations

import os
from dataclasses import dataclass

BASE_URL = "https://api.kiwoom.com"  # 운영 도메인(명세 au10001 meta "운영 도메인")
WS_URL = "wss://api.kiwoom.com:10000"

# 키움 한도: TR 마다 초당 5회. 기본 4 로 여유를 두고 1~5 로 자른다.
_DEFAULT_RATE = 4
_MIN_RATE = 1
_MAX_RATE = 5


@dataclass(frozen=True)
class KiwoomConfig:
    app_key: str
    app_secret: str
    rate_per_sec: int = _DEFAULT_RATE

    @property
    def base_url(self) -> str:
        return BASE_URL

    @property
    def ws_url(self) -> str:
        return WS_URL

    @property
    def is_configured(self) -> bool:
        """앱키·시크릿이 둘 다 있을 때만 True (없으면 키움 기능은 꺼짐)."""
        return bool(self.app_key and self.app_secret)


def _rate_from_env(raw: str | None) -> int:
    try:
        value = int(float(raw)) if raw and raw.strip() else _DEFAULT_RATE
    except ValueError:
        return _DEFAULT_RATE
    return max(_MIN_RATE, min(_MAX_RATE, value))


def get_kiwoom_config() -> KiwoomConfig:
    return KiwoomConfig(
        app_key=os.getenv("KIWOOM_APP_KEY", "").strip(),
        app_secret=os.getenv("KIWOOM_APP_SECRET", "").strip(),
        rate_per_sec=_rate_from_env(os.getenv("KIWOOM_RATE_PER_SEC")),
    )

"""한국투자증권(KIS) OpenAPI 접속 설정.

env로 자격증명을 주입하고, 모드(vps 모의투자 / prod 실서버)에 따라 REST BASE_URL을 결정한다.
Phase 1 수집 클라이언트는 이 설정을 읽어 OAuth 토큰 발급/시세 조회를 수행한다.

참조: docs/ams-reference/02-data-collection.md (2절 sandbox/production 분리)
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# 모드별 REST BASE URL
_BASE_URLS = {
    "prod": "https://openapi.koreainvestment.com:9443",  # 실서버(실계좌)
    "vps": "https://openapivts.koreainvestment.com:29443",  # 모의투자(sandbox)
}


@dataclass(frozen=True)
class KISConfig:
    app_key: str
    app_secret: str
    account_no: str  # 계좌번호(예: 12345678-01). 시세조회만 쓰면 비워도 됨
    mode: str  # 'vps'(모의투자·sandbox) | 'prod'(실서버)

    @property
    def base_url(self) -> str:
        return _BASE_URLS.get(self.mode, _BASE_URLS["vps"])

    @property
    def is_sandbox(self) -> bool:
        return self.mode != "prod"

    @property
    def is_configured(self) -> bool:
        """앱키/시크릿이 채워져 있으면 True (없으면 Mock 수집으로 폴백)."""
        return bool(self.app_key and self.app_secret)


def get_kis_config() -> KISConfig:
    return KISConfig(
        app_key=os.getenv("KIS_APP_KEY", ""),
        app_secret=os.getenv("KIS_APP_SECRET", ""),
        account_no=os.getenv("KIS_ACCOUNT_NO", ""),
        mode=os.getenv("KIS_MODE", "vps").strip().lower(),
    )

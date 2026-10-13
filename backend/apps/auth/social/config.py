"""간편 로그인 설정 — 요청 시점에 환경변수를 읽는다.

라우터는 `Depends(get_social_settings)` 로 받으므로 테스트는 dependency_overrides 로
키 유무·가짜 모드·운영 여부를 자유롭게 바꿀 수 있다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from shared import security

PROVIDERS: tuple[str, ...] = ("kakao", "naver")

DEFAULT_REDIRECT_BASE = "http://localhost:8001/api/v1/auth/social"
DEFAULT_WEB_RETURN_URL = "http://localhost:3000/auth/complete"
DEFAULT_APP_RETURN_URL_PROD = "stockapp://auth"
DEFAULT_APP_RETURN_URL_DEV = "stockapp-dev://auth"
# 가짜 공급자 모드를 허용하는 APP_ENV — 명시적으로 이 값일 때만(미설정·기타 값은 꺼짐, fail closed)
FAKE_MODE_ENVS = frozenset({"development", "test"})


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class SocialSettings:
    app_env: str = ""  # APP_ENV 원값(미설정이면 빈 문자열 — 가짜 모드 판단에서 기본값을 인정하지 않음)
    kakao_rest_api_key: str = ""
    kakao_client_secret: str = ""  # 카카오 콘솔에서 Client Secret 을 '사용함'으로 켠 경우만
    kakao_admin_key: str = ""  # 회원 탈퇴 시 카카오 연결 끊기(선택). 비면 생략
    naver_client_id: str = ""
    naver_client_secret: str = ""
    state_secret: str = ""  # 비면 JWT_SECRET_KEY 로 폴백
    redirect_base: str = DEFAULT_REDIRECT_BASE
    web_return_url: str = DEFAULT_WEB_RETURN_URL
    app_return_url_prod: str = DEFAULT_APP_RETURN_URL_PROD
    app_return_url_dev: str = DEFAULT_APP_RETURN_URL_DEV
    fake_provider_requested: bool = False  # SOCIAL_FAKE_PROVIDER 원값(development/test 에서만 유효)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def fake_mode(self) -> bool:
        """가짜 공급자 모드 — APP_ENV 가 명시적으로 development/test 이고 플래그가 켜졌을 때만."""
        return self.fake_provider_requested and self.app_env in FAKE_MODE_ENVS

    @property
    def effective_state_secret(self) -> str:
        return self.state_secret or security.SECRET_KEY

    def has_keys(self, provider: str) -> bool:
        if provider == "kakao":
            return bool(self.kakao_rest_api_key)
        if provider == "naver":
            return bool(self.naver_client_id and self.naver_client_secret)
        return False

    def is_enabled(self, provider: str) -> bool:
        return provider in PROVIDERS and (self.fake_mode or self.has_keys(provider))

    def redirect_uri(self, provider: str) -> str:
        """공급자 콘솔에 등록하는 Redirect URI 와 정확히 같아야 한다."""
        return f"{self.redirect_base.rstrip('/')}/{provider}/callback"

    def return_url(self, client: str, app_variant: str | None) -> str:
        """복귀 주소는 서버 설정에서만 고른다(오픈 리다이렉트 방지)."""
        if client == "app":
            return self.app_return_url_dev if app_variant == "dev" else self.app_return_url_prod
        return self.web_return_url


def load_social_settings() -> SocialSettings:
    env = os.getenv
    return SocialSettings(
        app_env=(env("APP_ENV") or "").strip(),
        kakao_rest_api_key=env("KAKAO_REST_API_KEY", ""),
        kakao_client_secret=env("KAKAO_CLIENT_SECRET", ""),
        kakao_admin_key=env("KAKAO_ADMIN_KEY", ""),
        naver_client_id=env("NAVER_CLIENT_ID", ""),
        naver_client_secret=env("NAVER_CLIENT_SECRET", ""),
        state_secret=env("SOCIAL_STATE_SECRET", ""),
        redirect_base=env("SOCIAL_REDIRECT_BASE", "") or DEFAULT_REDIRECT_BASE,
        web_return_url=env("SOCIAL_WEB_RETURN_URL", "") or DEFAULT_WEB_RETURN_URL,
        app_return_url_prod=env("SOCIAL_APP_RETURN_URL_PROD", "") or DEFAULT_APP_RETURN_URL_PROD,
        app_return_url_dev=env("SOCIAL_APP_RETURN_URL_DEV", "") or DEFAULT_APP_RETURN_URL_DEV,
        fake_provider_requested=_truthy(env("SOCIAL_FAKE_PROVIDER")),
    )


def get_social_settings() -> SocialSettings:
    """FastAPI 의존성 — 매 요청 env 를 다시 읽는다(테스트는 override)."""
    return load_social_settings()


def startup_warnings(settings: SocialSettings) -> list[str]:
    """기동 시 로그로 남길 설정 경고(운영에서 위험한 조합)."""
    warnings: list[str] = []
    if settings.fake_mode:
        warnings.append(
            f"SOCIAL_FAKE_PROVIDER 활성(APP_ENV={settings.app_env}) — 실제 공급자 없이 누구나 테스트 계정으로 로그인됩니다."
        )
    if settings.is_production and settings.fake_provider_requested:
        warnings.append("SOCIAL_FAKE_PROVIDER=true 는 운영(APP_ENV=production)에서 무시됩니다.")
    if settings.is_production and not settings.state_secret:
        warnings.append("SOCIAL_STATE_SECRET 미설정 — JWT_SECRET_KEY 로 폴백합니다. 운영에서는 별도 값을 설정하세요.")
    if settings.is_production and settings.redirect_base == DEFAULT_REDIRECT_BASE:
        warnings.append("SOCIAL_REDIRECT_BASE 미설정 — localhost 기본값이라 운영 콜백이 동작하지 않습니다.")
    if settings.is_production and settings.web_return_url == DEFAULT_WEB_RETURN_URL:
        warnings.append("SOCIAL_WEB_RETURN_URL 미설정 — localhost 기본값이라 웹 로그인 복귀가 실패합니다.")
    return warnings

"""외부 연동(AI 시황 분석) 설정 getter — 값은 호출 시점에 env 에서 읽는다(빈 문자열은 None).

Settings 클래스를 두지 않고 `apps/collector/fred.py:api_key()` 와 같은 함수형 패턴을 따른다.
비밀값은 여기서 절대 로그/출력하지 않는다.
"""
from __future__ import annotations

import os

# 스펙 원안의 gemini-2.0-flash 는 2026-06-01 공식 종료(지원 중단) → 현행 flash 계열을 기본값으로 둔다.
# 다른 모델을 쓰려면 GEMINI_MODEL 로 덮어쓴다.
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


def _env(name: str) -> str | None:
    v = (os.getenv(name) or "").strip()
    return v or None


def gemini_api_key() -> str | None:
    return _env("GEMINI_API_KEY")


def gemini_model() -> str:
    return _env("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL


# 네이버 검색 Open API(뉴스) 전용 키. 기존 NAVER_CLIENT_ID/SECRET 은 소셜 로그인(네이버 아이디로 로그인)
# 앱 키라 용도·권한(사용 API)이 다르므로 섞어 쓰지 않는다.
def naver_search_client_id() -> str | None:
    return _env("NAVER_SEARCH_CLIENT_ID")


def naver_search_client_secret() -> str | None:
    return _env("NAVER_SEARCH_CLIENT_SECRET")


def opendart_api_key() -> str | None:
    return _env("OPENDART_API_KEY")


def krx_credentials() -> tuple[str, str] | None:
    """pykrx 가 KRX(data.krx.co.kr) 로그인에 쓰는 KRX_ID/KRX_PW — 둘 다 있어야 반환."""
    uid, pw = _env("KRX_ID"), _env("KRX_PW")
    if uid and pw:
        return uid, pw
    return None

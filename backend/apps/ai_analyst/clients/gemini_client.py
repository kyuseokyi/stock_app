"""Google Gemini 구조화(JSON) 응답 클라이언트 — google-genai SDK.

- response_mime_type=application/json + response_schema(pydantic) 로 요청하고,
  받은 텍스트를 다시 `schema.model_validate_json` 으로 검증한다(모델이 스키마를 어겨도 안전).
- 키 없음·예외·검증 실패는 None + warning. 키·응답 원문은 로그에 남기지 않는다.
"""
from __future__ import annotations

import logging
from typing import TypeVar

from pydantic import BaseModel

from shared import config

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_TEMPERATURE = 0.2


def _short(e: Exception) -> str:
    """예외 타입 + 짧은 메시지(앞 120자) — 원문 응답이 섞이지 않도록 자른다."""
    return f"{type(e).__name__}: {str(e)[:120]}"


class GeminiClient:
    def __init__(self, api_key: str | None, model: str | None = None, *, client=None):
        """client: 테스트용 주입(`.models.generate_content(...)` 를 가진 객체). 없으면 genai.Client 를 만든다."""
        self.api_key = api_key
        self.model = model or config.gemini_model()
        self._client = client
        if self._client is None and api_key:
            from google import genai  # 지연 import — 키 없는 환경에서 불필요한 로딩 방지

            self._client = genai.Client(api_key=api_key)

    def generate_json(self, prompt: str, schema: type[T], *, system: str | None = None) -> T | None:
        if self._client is None:
            log.warning("Gemini 키가 없어 호출을 건너뜀")
            return None
        try:
            from google.genai import types

            resp = self._client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=_TEMPERATURE,
                    system_instruction=system,
                ),
            )
        except Exception as e:  # noqa: BLE001 — 외부 API 실패는 None 으로 흡수
            log.warning("Gemini 호출 실패 (%s)", _short(e))
            return None
        text = getattr(resp, "text", None)
        if not text:
            log.warning("Gemini 응답이 비어 있음")
            return None
        try:
            return schema.model_validate_json(text)
        except Exception as e:  # noqa: BLE001 — ValidationError 등
            log.warning("Gemini 응답 스키마 검증 실패 (%s)", type(e).__name__)
            return None


def get_gemini_client() -> GeminiClient | None:
    key = config.gemini_api_key()
    if not key:
        return None
    return GeminiClient(key, config.gemini_model())

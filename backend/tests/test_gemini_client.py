"""GeminiClient — 가짜 내부 client 주입(실제 Gemini 호출 없음)."""
from __future__ import annotations

import logging

from pydantic import BaseModel

from apps.ai_analyst.clients.gemini_client import GeminiClient


class _Brief(BaseModel):
    headline: str
    score: int


class _Resp:
    def __init__(self, text):
        self.text = text


class _Models:
    def __init__(self, result):
        self.result = result
        self.calls: list[dict] = []

    def generate_content(self, **kw):
        self.calls.append(kw)
        if isinstance(self.result, Exception):
            raise self.result
        return _Resp(self.result)


class _FakeGenai:
    def __init__(self, result):
        self.models = _Models(result)


def test_valid_json_returns_model_and_passes_config():
    fake = _FakeGenai('{"headline": "반도체 강세", "score": 3}')
    c = GeminiClient("k", "gemini-test", client=fake)
    out = c.generate_json("프롬프트", _Brief, system="너는 애널리스트")
    assert out == _Brief(headline="반도체 강세", score=3)
    call = fake.models.calls[0]
    assert call["model"] == "gemini-test"
    assert call["contents"] == "프롬프트"
    cfg = call["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.temperature == 0.2
    assert cfg.response_schema is _Brief
    assert cfg.system_instruction == "너는 애널리스트"


def test_broken_json_returns_none(caplog):
    c = GeminiClient("k", "m", client=_FakeGenai('{"headline": "x"'))
    with caplog.at_level(logging.WARNING):
        assert c.generate_json("p", _Brief) is None
    assert '{"headline"' not in caplog.text  # 응답 원문은 로그에 남기지 않음


def test_schema_mismatch_returns_none():
    c = GeminiClient("k", "m", client=_FakeGenai('{"headline": "x", "score": "많음"}'))
    assert c.generate_json("p", _Brief) is None


def test_exception_returns_none(caplog):
    c = GeminiClient("secret-key", "m", client=_FakeGenai(RuntimeError("quota exceeded")))
    with caplog.at_level(logging.WARNING):
        assert c.generate_json("p", _Brief) is None
    assert "RuntimeError" in caplog.text
    assert "secret-key" not in caplog.text


def test_empty_text_returns_none():
    c = GeminiClient("k", "m", client=_FakeGenai(""))
    assert c.generate_json("p", _Brief) is None


def test_no_key_no_client_returns_none():
    c = GeminiClient(None, "m")
    assert c.generate_json("p", _Brief) is None

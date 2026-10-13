"""게스트 로그인 백엔드 게이트 — AUTH_GUEST_ENABLED / APP_ENV 조합 테스트.

게이트는 요청 시점에 env 를 읽는다. 로컬은 shared/env.py 가 `.env.development` 를 로드해
APP_ENV=development 가 들어올 수 있으므로, 각 테스트가 두 키를 먼저 지우고 필요한 값만 넣는다.
"""
from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apps.auth.main import app
from shared.database import get_db
from shared.models import Base

GUEST = "/api/v1/auth/guest"


@pytest.fixture
async def client():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("AUTH_GUEST_ENABLED", raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)

    def _set(*, guest: str | None = None, app_env: str | None = None) -> None:
        if guest is not None:
            monkeypatch.setenv("AUTH_GUEST_ENABLED", guest)
        if app_env is not None:
            monkeypatch.setenv("APP_ENV", app_env)

    return _set


@pytest.mark.parametrize(
    ("guest", "app_env", "allowed"),
    [
        ("true", "production", True),   # 명시 true — APP_ENV 무관
        ("TRUE", None, True),
        ("false", "development", False),  # 명시 false — APP_ENV 무관
        (None, "development", True),    # 미설정 → dev/test 만 켬
        (None, "test", True),
        (None, "production", False),
        (None, None, False),            # 둘 다 미설정 → fail closed
        ("", "production", False),      # 빈 값 = 미설정
        ("maybe", "development", False),  # 알 수 없는 값 → fail closed
    ],
)
async def test_guest_gate(client, env, guest, app_env, allowed):
    env(guest=guest, app_env=app_env)
    r = await client.post(GUEST, json={"nickname": "주린이"})
    if allowed:
        assert r.status_code == 200, r.text
        assert r.json()["user"]["nickname"] == "주린이"
    else:
        assert r.status_code == 404
        assert r.json() == {"detail": "Not Found"}


async def test_guest_gate_closed_hides_validation(client, env):
    """꺼져 있으면 본문 검증(422)보다 먼저 404 — 엔드포인트 존재를 드러내지 않는다."""
    env(app_env="production")
    r = await client.post(GUEST, json={})
    assert r.status_code == 404
    assert r.json() == {"detail": "Not Found"}

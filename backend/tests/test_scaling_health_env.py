"""수평 확장 — `/health`(생존)·`/ready`(DB+Redis, 실패 503) · `*_FILE` env."""
from __future__ import annotations

import asyncio

import httpx
import pytest
from fakeredis import aioredis as fake_aioredis
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import shared.database as database
from shared import health
from shared.env import apply_file_env


@pytest.fixture
async def sqlite_maker():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def _broken_maker():
    raise ConnectionError("db down")


class _BrokenRedis:
    async def ping(self):
        raise ConnectionError("redis down")


class _HangingRedis:
    async def ping(self):
        await asyncio.sleep(10)


def _apps():
    from apps.auth import deps as auth_deps
    from apps.auth.main import app as auth_app
    from apps.blog import events as blog_events
    from apps.blog.main import app as blog_app
    from apps.stock_api.main import app as stock_app
    from apps.trading_game import deps as game_deps
    from apps.trading_game.main import app as game_app

    return {
        "auth": (auth_app, auth_deps),
        "blog": (blog_app, blog_events),
        "stock_api": (stock_app, None),
        "trading_game": (game_app, game_deps),
    }


async def _get(app, path):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        return await c.get(path)


@pytest.mark.parametrize("service", ["auth", "blog", "stock_api", "trading_game"])
async def test_health_unchanged_and_ready_ok(service, sqlite_maker, monkeypatch):
    app, redis_mod = _apps()[service]
    monkeypatch.setattr(database, "AsyncSessionLocal", sqlite_maker)
    if redis_mod is not None:
        fake = fake_aioredis.FakeRedis(decode_responses=True)
        monkeypatch.setattr(redis_mod, "get_redis", lambda: fake)
    r = await _get(app, "/health")
    assert r.status_code == 200 and r.json() == {"status": "ok", "service": service}  # 기존 형식 유지
    r = await _get(app, "/ready")
    expected_checks = {"db": "ok", "redis": "ok"} if redis_mod is not None else {"db": "ok"}
    assert r.status_code == 200
    assert r.json() == {"status": "ready", "service": service, "checks": expected_checks}


@pytest.mark.parametrize("service", ["auth", "blog", "stock_api", "trading_game"])
async def test_ready_503_when_db_down(service, monkeypatch):
    app, redis_mod = _apps()[service]
    monkeypatch.setattr(database, "AsyncSessionLocal", _broken_maker)
    if redis_mod is not None:
        fake = fake_aioredis.FakeRedis(decode_responses=True)
        monkeypatch.setattr(redis_mod, "get_redis", lambda: fake)
    r = await _get(app, "/ready")
    assert r.status_code == 503
    assert r.json()["status"] == "not_ready" and r.json()["checks"]["db"] == "fail"
    assert (await _get(app, "/health")).status_code == 200  # 생존 프로브는 의존성 미검사


@pytest.mark.parametrize("service", ["auth", "blog", "trading_game"])
async def test_ready_503_when_redis_down(service, sqlite_maker, monkeypatch):
    app, redis_mod = _apps()[service]
    monkeypatch.setattr(database, "AsyncSessionLocal", sqlite_maker)
    monkeypatch.setattr(redis_mod, "get_redis", lambda: _BrokenRedis())
    r = await _get(app, "/ready")
    assert r.status_code == 503
    assert r.json()["checks"] == {"db": "ok", "redis": "fail"}


async def test_ready_check_times_out(monkeypatch):
    monkeypatch.setenv("READY_CHECK_TIMEOUT_SEC", "0.05")
    ok, results = await health.run_checks({"redis": lambda: health.check_redis(_HangingRedis())})
    assert ok is False and results == {"redis": "fail"}


# ---------------------------------------------------------------- *_FILE env
def test_file_env_fills_missing_value(tmp_path):
    secret = tmp_path / "jwt"
    secret.write_text("  s3cr3t\n", encoding="utf-8")
    env = {"JWT_SECRET_FILE": str(secret)}
    assert apply_file_env(env) == ["JWT_SECRET"]
    assert env["JWT_SECRET"] == "s3cr3t"  # 앞뒤 공백·개행 제거


def test_file_env_does_not_override_existing(tmp_path):
    secret = tmp_path / "pw"
    secret.write_text("from-file", encoding="utf-8")
    env = {"DB_PASSWORD": "from-env", "DB_PASSWORD_FILE": str(secret)}
    assert apply_file_env(env) == []
    assert env["DB_PASSWORD"] == "from-env"


def test_file_env_empty_value_is_treated_as_unset(tmp_path):
    secret = tmp_path / "k"
    secret.write_text("v", encoding="utf-8")
    env = {"KIS_APP_SECRET": "", "KIS_APP_SECRET_FILE": str(secret)}
    apply_file_env(env)
    assert env["KIS_APP_SECRET"] == "v"


def test_file_env_unreadable_fails_loudly(tmp_path):
    with pytest.raises(RuntimeError, match="MISSING_FILE"):
        apply_file_env({"MISSING_FILE": str(tmp_path / "nope")})


def test_file_env_ignores_bare_suffix_and_empty_path():
    env = {"_FILE": "/x", "EMPTY_FILE": ""}
    assert apply_file_env(env) == []
    assert "EMPTY" not in env


def test_file_env_applies_to_process_environ(tmp_path, monkeypatch):
    secret = tmp_path / "s"
    secret.write_text("abc", encoding="utf-8")
    monkeypatch.delenv("SCALE_TEST_SECRET", raising=False)
    monkeypatch.setenv("SCALE_TEST_SECRET_FILE", str(secret))
    apply_file_env()
    import os

    assert os.environ["SCALE_TEST_SECRET"] == "abc"
    monkeypatch.delenv("SCALE_TEST_SECRET")

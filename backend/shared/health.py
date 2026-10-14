"""준비 상태 프로브 — `/ready`(DB `SELECT 1` + 선택적으로 Redis `PING`, 실패 시 503).

`/health` 는 각 앱이 기존대로 프로세스 생존만 응답(의존성 미검사 — liveness).
`/ready` 는 의존성까지 확인(readiness) — 로드밸런서·오케스트레이터가 트래픽 투입 여부를 판단.
각 검사는 READY_CHECK_TIMEOUT_SEC(기본 2초) 안에 끝나지 않으면 실패로 본다(프로브가 매달리지 않게).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Awaitable, Callable

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text

log = logging.getLogger("shared.health")

DEFAULT_TIMEOUT_SEC = 2.0


def _timeout() -> float:
    try:
        v = float(os.getenv("READY_CHECK_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC))
        return v if v > 0 else DEFAULT_TIMEOUT_SEC
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


async def check_db(session_factory=None) -> None:
    if session_factory is None:
        from shared.database import AsyncSessionLocal

        session_factory = AsyncSessionLocal
    async with session_factory() as db:
        await db.execute(text("SELECT 1"))


async def check_redis(redis) -> None:
    if not await redis.ping():
        raise RuntimeError("redis ping returned false")


async def run_checks(checks: dict[str, Callable[[], Awaitable[Any]]]) -> tuple[bool, dict[str, str]]:
    timeout = _timeout()
    results: dict[str, str] = {}
    for name, fn in checks.items():
        try:
            await asyncio.wait_for(fn(), timeout=timeout)
            results[name] = "ok"
        except Exception as e:  # noqa: BLE001 — 프로브는 원인 종류만 노출
            log.warning("ready 검사 실패 %s: %s", name, type(e).__name__)
            results[name] = "fail"
    return all(v == "ok" for v in results.values()), results


def add_health_routes(
    app: FastAPI,
    service: str,
    *,
    redis_getter: Callable[[], Any] | None = None,
) -> None:
    """`/ready` 등록. redis_getter 가 있으면 Redis PING 도 검사."""

    async def ready():
        checks: dict[str, Callable[[], Awaitable[Any]]] = {"db": check_db}
        if redis_getter is not None:
            checks["redis"] = lambda: check_redis(redis_getter())
        ok, results = await run_checks(checks)
        body = {"status": "ready" if ok else "not_ready", "service": service, "checks": results}
        return JSONResponse(body, status_code=200 if ok else 503)

    app.add_api_route("/ready", ready, methods=["GET"], tags=["health"])

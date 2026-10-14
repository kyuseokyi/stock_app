"""인증 마이크로서비스 (FastAPI).

역할: 소셜/이메일 로그인, JWT 발급·검증, 권한 관리 전담.

실행:
    cd backend
    uv run uvicorn apps.auth.main:app --reload --port 8001
문서: http://localhost:8001/docs
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins
from shared.health import add_health_routes

from . import deps
from .routers import auth, social
from .social.config import load_social_settings, startup_warnings

logger = logging.getLogger("auth")

app = FastAPI(title="Stock App - Auth Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(social.router)

# 간편 로그인 설정 경고(운영에서 가짜 공급자 켜짐·state 키 미설정) — 기동 시 1회
for _msg in startup_warnings(load_social_settings()):
    logger.warning("[social] %s", _msg)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "auth"}


add_health_routes(app, "auth", redis_getter=lambda: deps.get_redis())  # /ready(DB + Redis)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.auth.main:app", host="0.0.0.0", port=8001, reload=True)

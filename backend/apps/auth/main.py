"""인증 마이크로서비스 (FastAPI).

역할: 소셜/이메일 로그인, JWT 발급·검증, 권한 관리 전담.

실행:
    cd backend
    uv run uvicorn apps.auth.main:app --reload --port 8001
문서: http://localhost:8001/docs
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth

app = FastAPI(title="Stock App - Auth Service", version="0.1.0")

_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_extra = os.getenv("CORS_ORIGINS", "")
ALLOWED_ORIGINS = _default_origins + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "auth"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.auth.main:app", host="0.0.0.0", port=8001, reload=True)

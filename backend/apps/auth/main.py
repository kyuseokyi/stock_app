"""인증 마이크로서비스 (FastAPI).

역할: 소셜/이메일 로그인, JWT 발급·검증, 권한 관리 전담.

실행:
    cd backend
    uv run uvicorn apps.auth.main:app --reload --port 8001
문서: http://localhost:8001/docs
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins

from .routers import auth

app = FastAPI(title="Stock App - Auth Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
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

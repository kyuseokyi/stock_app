"""블로그 관리 마이크로서비스 (FastAPI).

실행:
    cd backend
    uv run uvicorn apps.blog.main:app --reload
문서: http://localhost:8000/docs
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import blogs, boards, comments

app = FastAPI(title="Stock App - Blog Service", version="0.1.0")

# --- CORS (어드민 웹 로컬 개발 허용) ---
# 기본으로 Vite(5173)/CRA(3000) 로컬 오리진을 허용하고, 환경변수로 확장 가능.
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

# --- 라우터 등록 ---
app.include_router(boards.router)
app.include_router(blogs.router)
app.include_router(comments.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "blog"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.blog.main:app", host="0.0.0.0", port=8000, reload=True)

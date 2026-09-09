"""블로그 관리 마이크로서비스 (FastAPI).

실행:
    cd backend
    uv run uvicorn apps.blog.main:app --reload
문서: http://localhost:8000/docs
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins

from .routers import blogs, boards, comments, notifications

app = FastAPI(title="Stock App - Blog Service", version="0.1.0")

# --- CORS --- (local/develop/product 공통 정책은 shared.cors 참조)
app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 라우터 등록 ---
app.include_router(boards.router)
app.include_router(blogs.router)
app.include_router(comments.router)
app.include_router(notifications.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "blog"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.blog.main:app", host="0.0.0.0", port=8000, reload=True)

"""주식 API 마이크로서비스 (FastAPI) — 스켈레톤.

역할: 스크리너 검색 결과, 차트 데이터 등 조회 전용(ClickHouse 주 통신).
아직 뼈대만 존재하며, 스크리너/차트 라우터는 후속 단계에서 추가한다.

실행:
    cd backend
    uv run uvicorn apps.stock_api.main:app --reload --port 8002
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Stock App - Stock API Service", version="0.1.0")

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

# TODO: app.include_router(stocks.router)  # /api/v1/stocks (스크리너/차트)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "stock_api"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.stock_api.main:app", host="0.0.0.0", port=8002, reload=True)

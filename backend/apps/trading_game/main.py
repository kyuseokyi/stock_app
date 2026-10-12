"""트레이딩 게임 마이크로서비스 (FastAPI, Port 8003).

실행(단일 워커 필수 — 인메모리 WS 레지스트리/리스너):
    cd backend
    uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1
"""
from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from shared.cors import build_allowed_origins
from apps.trading_game import deps
from apps.trading_game.routers import coach, feature_flags, leaderboard, orders, quiz, ws_gateway
from apps.trading_game.services.tick_listener import fanout_worker, run_listener

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    listener = asyncio.create_task(run_listener(REDIS_URL, stop))
    fanout = asyncio.create_task(fanout_worker(stop))
    sentiment = asyncio.create_task(ws_gateway._sentiment_loop(stop))
    try:
        yield
    finally:
        stop.set()
        for task in (listener, fanout, sentiment):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        with contextlib.suppress(Exception):
            await deps.get_redis().aclose()


app = FastAPI(title="Stock App - Trading Game", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=build_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(orders.router)
app.include_router(ws_gateway.router)
app.include_router(leaderboard.router)
app.include_router(coach.router)
app.include_router(feature_flags.router)
app.include_router(quiz.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "trading_game"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.trading_game.main:app", host="0.0.0.0", port=8003, reload=True)

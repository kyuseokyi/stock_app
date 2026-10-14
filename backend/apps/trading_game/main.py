"""트레이딩 게임 마이크로서비스 (FastAPI, Port 8003).

실행:
    cd backend
    uv run uvicorn apps.trading_game.main:app --reload --port 8003 --workers 1

인스턴스(컨테이너/파드) N개 실행 가능 — 프로세스당 워커는 1개(--workers 1)로 두고 인스턴스를 늘린다.
  - 모든 인스턴스: WS 버스 구독(ws_bus — 자기 로컬 접속자에게 전달 + game:cache:dirty), 넛지 fan-out.
  - 리더 1개(services/leader, Redis 락): 틱 리스너(+자동청산), 틱 묶기 전송, 개인손익·랭킹, 시장심리.
종료(SIGTERM): 리더 락 반납 → 구독 해제 → 로컬 WS close(1001).
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
from apps.trading_game.routers import (
    academy, academy_admin, coach, feature_flags, leaderboard, orders, quests, quiz, quiz_admin, ws_gateway,
)
from apps.trading_game.services import position_cache, ws_bus
from apps.trading_game.services.connection_manager import manager
from apps.trading_game.services.leader import LeaderElector
from apps.trading_game.services.tick_listener import broadcast_loop, fanout_worker, pnl_loop, run_listener

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
LEADER_NAME = "trading_game"


def singleton_tasks():
    """리더만 실행하는 작업들 — 각자 term 전용 stop 이벤트를 받는다."""
    return [
        lambda s: run_listener(REDIS_URL, s),   # 틱 구독 + 자동청산
        broadcast_loop,                         # 틱 묶기 전송(GAME_WS_TICK_INTERVAL_SEC)
        pnl_loop,                               # 개인손익·랭킹(GAME_WS_PNL_INTERVAL_SEC)
        ws_gateway._sentiment_loop,             # 시장심리
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = asyncio.Event()
    bus = asyncio.create_task(ws_bus.run_subscriber(
        manager, stop, extra_channels={position_cache.DIRTY_CHANNEL: position_cache.mark_dirty_local},
    ))
    fanout = asyncio.create_task(fanout_worker(stop))
    elector = LeaderElector(deps.get_redis(), LEADER_NAME)
    supervisor = asyncio.create_task(elector.run(
        stop, singleton_tasks(), on_gain=position_cache.mark_dirty_local,  # 리더 획득 시 캐시 재적재
    ))
    try:
        yield
    finally:
        stop.set()
        # 1) 리더 작업 중지 + 락 반납(감독 루프가 stop 을 보고 정상 종료) → 다른 인스턴스 즉시 승계
        with contextlib.suppress(Exception):
            await asyncio.wait_for(asyncio.shield(supervisor), timeout=5)
        # 2) 구독 해제·fan-out 종료
        for task in (supervisor, bus, fanout):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        # 3) 로컬 WS close(1001) — 클라이언트가 다른 인스턴스로 재연결
        with contextlib.suppress(Exception):
            await manager.close_all(1001)
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
app.include_router(quests.router)
app.include_router(academy.router)
app.include_router(academy_admin.router)
app.include_router(quiz_admin.router)


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "service": "trading_game"}



if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.trading_game.main:app", host="0.0.0.0", port=8003, reload=True)

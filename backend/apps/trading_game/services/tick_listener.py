"""Redis 구독 → 자동청산 + 개인손익 push. lifespan 백그라운드 태스크."""
from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal

import redis.asyncio as aioredis
from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import GameAccount, GamePosition, GameSeason
from apps.trading_game.services import account_service, liquidation_service, pricing
from apps.trading_game.services.connection_manager import manager

log = logging.getLogger("trading_game.listener")


async def _push_personal_pnl(ticker: str, price: Decimal) -> None:
    """현재 WS 접속 유저들의 보유 포지션 평가손익을 개인 push."""
    uids = manager.user_ids()
    if not uids:
        return
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(GamePosition, GameAccount.user_id)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(
                GamePosition.status == "OPEN",
                GameSeason.ticker == ticker,
                GameAccount.user_id.in_(uids),
            )
        )
        for pos, user_id in rows.all():
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            await manager.send_to_user(user_id, {
                "type": "position_pnl",
                "position_id": str(pos.id),
                "roi_pct": float(roi),
                "pnl_amount": float(pnl),
            })


async def _handle_tick(raw: str) -> None:
    tick = json.loads(raw)
    ticker = tick["ticker"]
    price = Decimal(str(tick["price"]))
    async with AsyncSessionLocal() as db:
        await liquidation_service.check_and_liquidate(db, ticker, price)
    await manager.broadcast({"type": "tick", "ticker": ticker, "price": tick["price"],
                             "timestamp": tick.get("timestamp")})
    await _push_personal_pnl(ticker, price)


async def run_listener(redis_url: str, stop: asyncio.Event) -> None:
    """ACTIVE 시즌 종목을 구독. 끊김 시 지수 백오프 재연결."""
    backoff = 1
    while not stop.is_set():
        try:
            async with AsyncSessionLocal() as db:
                season = await account_service.get_active_season(db)
            if season is None:
                log.warning("ACTIVE 시즌 없음 — 리스너 대기")
                try:
                    await asyncio.wait_for(stop.wait(), timeout=10)
                except asyncio.TimeoutError:
                    pass
                continue
            redis = aioredis.from_url(redis_url, decode_responses=True)
            pubsub = redis.pubsub()
            try:
                await pubsub.subscribe(f"stock:tick:{season.ticker}")
                log.info("구독 시작 stock:tick:%s", season.ticker)
                async for msg in pubsub.listen():
                    if stop.is_set():
                        break
                    if msg.get("type") != "message":
                        continue
                    backoff = 1  # 실제 데이터 수신 성공 → 백오프 리셋
                    try:
                        await _handle_tick(msg["data"])
                    except Exception:
                        log.exception("틱 처리 실패 — skip")
            finally:
                await pubsub.aclose()
                await redis.aclose()
        except asyncio.CancelledError:
            break
        except Exception:
            log.exception("리스너 오류 — %ss 후 재연결", backoff)
            try:
                await asyncio.wait_for(stop.wait(), timeout=backoff)
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 30)
    log.info("틱 리스너 종료")

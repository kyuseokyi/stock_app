"""Redis 구독 → 자동청산(인라인) + fan-out(별도 태스크). lifespan 백그라운드."""
from __future__ import annotations

import asyncio
import json
import logging
from decimal import Decimal

import redis.asyncio as aioredis
from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import INITIAL_CASH, GameAccount, GamePosition, GameSeason
from apps.trading_game import deps
from apps.trading_game.services import (
    account_service, liquidation_service, nudge_engine, pricing, ranking_service,
)
from apps.trading_game.services.connection_manager import manager

log = logging.getLogger("trading_game.listener")

_FANOUT_MAXSIZE = 256
_fanout_q: asyncio.Queue | None = None


def _get_fanout_queue() -> asyncio.Queue:
    global _fanout_q
    if _fanout_q is None:
        _fanout_q = asyncio.Queue(maxsize=_FANOUT_MAXSIZE)
    return _fanout_q


async def _push_personal_pnl(ticker: str, price: Decimal) -> None:
    """활성 시즌 보유자 전원의 라이브 ROI 를 ZADD(랭킹), 접속자에겐 개인손익 push."""
    connected = set(manager.user_ids())
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(GamePosition, GameAccount)
            .join(GameAccount, GamePosition.account_id == GameAccount.id)
            .join(GameSeason, GameAccount.season_id == GameSeason.id)
            .where(
                GamePosition.status == "OPEN",
                GameSeason.ticker == ticker,
                GameSeason.status == "ACTIVE",
            )
        )
        redis = deps.get_redis()
        for pos, acc in rows.all():
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, INITIAL_CASH)
            await ranking_service.update_rank(redis, acc.season_id, acc.user_id, live)
            if acc.user_id in connected:
                await manager.send_to_user(acc.user_id, {
                    "type": "position_pnl", "position_id": str(pos.id),
                    "roi_pct": float(roi), "pnl_amount": float(pnl),
                })


def _enqueue(item: tuple) -> None:
    """fan-out 큐 적재(가득 차면 가장 오래된 것 드롭 — 청산/소비를 막지 않음)."""
    q = _get_fanout_queue()
    if q.full():
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        pass


def _enqueue_fanout(tick: dict, price: Decimal) -> None:
    _enqueue(("tick", tick, price))


def _enqueue_nudge(user_id: int, position_id: str, nudge: dict) -> None:
    _enqueue(("nudge", user_id, {"type": "nudge", "position_id": position_id, "nudge": nudge}))


def _queue_close_nudges(result: liquidation_service.LiquidationResult) -> None:
    """자동청산 넛지를 큐에 적재 — 실패해도 청산·랭킹에 영향 없음(best-effort)."""
    try:
        trade = result.trade
        for n in nudge_engine.nudges_for_close(closed_reason=trade.closed_reason, roi_pct=trade.roi_pct):
            _enqueue_nudge(result.user_id, str(trade.position_id), n.to_dict())
    except Exception:
        log.warning("자동청산 넛지 적재 실패 — skip", exc_info=True)


async def fanout_worker(stop: asyncio.Event) -> None:
    """큐에서 틱을 받아 WS 브로드캐스트 + 개인손익 push(리스너와 분리된 경로)."""
    q = _get_fanout_queue()
    while not stop.is_set():
        try:
            item = await asyncio.wait_for(q.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except asyncio.CancelledError:
            break
        try:
            if item[0] == "nudge":
                _, user_id, payload = item
                await manager.send_to_user(user_id, payload)
                continue
            _, tick, price = item
            await manager.broadcast({
                "type": "tick", "ticker": tick["ticker"], "price": tick["price"],
                "timestamp": tick.get("timestamp"),
            })
            await _push_personal_pnl(tick["ticker"], price)
        except Exception:
            log.exception("fan-out 실패 — skip")
    log.info("fan-out 워커 종료")


async def _handle_tick(raw: str) -> None:
    tick = json.loads(raw)
    ticker = tick["ticker"]
    price = Decimal(str(tick["price"]))
    # 청산은 리스너 코루틴에서 인라인(정확성 우선)
    async with AsyncSessionLocal() as db:
        results = await liquidation_service.liquidate_for_tick(db, ticker, price)
        for r in results:
            _queue_close_nudges(r)  # 인라인 send 금지 — 큐로 위임(랭킹 실패와 무관하게 먼저 적재)
            try:
                await ranking_service.sync_account_rank(deps.get_redis(), db, r.trade.account_id)
            except Exception:
                log.warning("랭킹 동기화 실패(청산은 정상 완료) account=%s", r.trade.account_id, exc_info=True)
    # fan-out 은 별도 워커로 위임(느린 클라이언트가 청산/소비를 막지 않게)
    _enqueue_fanout(tick, price)


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

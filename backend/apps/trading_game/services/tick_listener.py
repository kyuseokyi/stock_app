"""Redis 구독 → 자동청산(인라인, 캐시 후보 + DB 확정) + 묶기 전송 루프. 리더 인스턴스에서만 실행(services/leader).

전송은 모두 ws_bus(Redis Pub/Sub) 발행 → 각 인스턴스가 자기 로컬 접속자에게 전달.

- 리스너: 틱마다 청산 검사(포지션 캐시로 후보만 — DB 조회 없음, 후보 있을 때만 DB 확정) + 최신 틱 덮어쓰기.
- broadcast_loop(GAME_WS_TICK_INTERVAL_SEC=0.25): 새 틱이 있으면 최신 1개만 전체 전송.
- pnl_loop(GAME_WS_PNL_INTERVAL_SEC=1.0): 새 가격이 있으면 캐시+최신가로 ROI → 랭킹 ZADD + 개인손익 push.
- fan-out 큐(256, oldest-drop)는 자동청산 넛지 전달용.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal

import redis.asyncio as aioredis

from shared.database import AsyncSessionLocal
from apps.trading_game import deps
from apps.trading_game.services import (
    account_service, liquidation_service, nudge_engine, position_cache, pricing, ranking_service, weekly_ranking,
)
from apps.trading_game.services import ws_bus

log = logging.getLogger("trading_game.listener")

_FANOUT_MAXSIZE = 256
_fanout_q: asyncio.Queue | None = None

DEFAULT_TICK_INTERVAL_SEC = 0.25
DEFAULT_PNL_INTERVAL_SEC = 1.0

# 최신 틱(덮어쓰기) + 순번. 루프별로 마지막 처리 순번을 기억해 '새 틱이 있을 때만' 전송.
_latest: tuple[dict, Decimal] | None = None
_tick_seq = 0
_broadcast_seq = 0
_pnl_seq = 0


def _env_interval(name: str, default: float) -> float:
    try:
        v = float(os.getenv(name, default))
        return v if v > 0 else default
    except ValueError:
        return default


def tick_interval() -> float:
    return _env_interval("GAME_WS_TICK_INTERVAL_SEC", DEFAULT_TICK_INTERVAL_SEC)


def pnl_interval() -> float:
    return _env_interval("GAME_WS_PNL_INTERVAL_SEC", DEFAULT_PNL_INTERVAL_SEC)


def reset_conflation_state() -> None:
    """테스트용 — 최신 틱·순번·fan-out 큐 초기화."""
    global _latest, _tick_seq, _broadcast_seq, _pnl_seq, _fanout_q
    _latest = None
    _tick_seq = _broadcast_seq = _pnl_seq = 0
    _fanout_q = None


def latest_tick() -> tuple[dict, Decimal] | None:
    return _latest


def _store_latest(tick: dict, price: Decimal) -> None:
    global _latest, _tick_seq
    _latest = (tick, price)
    _tick_seq += 1


def _get_fanout_queue() -> asyncio.Queue:
    global _fanout_q
    if _fanout_q is None:
        _fanout_q = asyncio.Queue(maxsize=_FANOUT_MAXSIZE)
    return _fanout_q


def _season_open(window, now: datetime) -> bool:
    """캐시된 시즌 창 기준 종료 전인지(정산 반영 전 TTL 동안 끝난 시즌 랭킹 갱신 방지)."""
    if window is None or window[1] is None:
        return True
    return now < weekly_ranking.aware(window[1])


async def _push_personal_pnl(ticker: str, price: Decimal) -> None:
    """활성 시즌 보유자 전원의 라이브 ROI 를 ZADD(랭킹) + 개인손익 발행. 포지션 캐시 사용.

    접속 여부는 인스턴스마다 다르므로(리더는 자기 로컬만 앎) 보유자 전원에게 publish_user —
    각 인스턴스 구독자가 자기 로컬 접속자만 골라 전달한다.
    """
    snap = await position_cache.cache.get(AsyncSessionLocal)
    redis = deps.get_redis()
    now = datetime.now(timezone.utc)
    for pos in snap.for_ticker(ticker):
        try:
            acc = snap.accounts[pos.account_id]
            window = snap.season_windows.get(pos.season_id)
            roi = pricing.compute_roi_pct(pos.side, pos.entry_price, price, pos.leverage)
            pnl = pricing.compute_pnl(pos.size_amount, roi)
            if _season_open(window, now):
                live = ranking_service.compute_live_roi(acc.cash_balance, pos, price, acc.principal)
                await ranking_service.update_rank(
                    redis, pos.season_id, pos.user_id, live, season_window=window,
                )
            await ws_bus.publish_user(pos.user_id, {
                "type": "position_pnl", "position_id": str(pos.position_id),
                "roi_pct": float(roi), "pnl_amount": float(pnl),
            })
        except Exception:
            log.warning("개인손익/랭킹 갱신 실패 — skip position=%s", pos.position_id, exc_info=True)


async def broadcast_once() -> bool:
    """마지막 전송 이후 새 틱이 있으면 최신 1개를 전체(로그인+공개)에 전송. 전송했으면 True."""
    global _broadcast_seq
    if _latest is None or _tick_seq == _broadcast_seq:
        return False
    _broadcast_seq = _tick_seq
    tick, _ = _latest
    await ws_bus.publish_all({
        "type": "tick", "ticker": tick["ticker"], "price": tick["price"],
        "timestamp": tick.get("timestamp"),
    })
    return True


async def push_pnl_once() -> bool:
    """마지막 처리 이후 새 가격이 있으면 개인손익·랭킹 갱신. 처리했으면 True."""
    global _pnl_seq
    if _latest is None or _tick_seq == _pnl_seq:
        return False
    _pnl_seq = _tick_seq
    tick, price = _latest
    await _push_personal_pnl(tick["ticker"], price)
    return True


async def _run_periodic(stop: asyncio.Event, interval: float, once, name: str) -> None:
    while not stop.is_set():
        try:
            await once()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("%s 실패 — 다음 주기 재시도", name)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval)
    log.info("%s 종료", name)


async def broadcast_loop(stop: asyncio.Event, interval: float | None = None) -> None:
    await _run_periodic(stop, interval or tick_interval(), lambda: broadcast_once(), "틱 브로드캐스트 루프")


async def pnl_loop(stop: asyncio.Event, interval: float | None = None) -> None:
    await _run_periodic(stop, interval or pnl_interval(), lambda: push_pnl_once(), "개인손익 루프")


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
    """큐에서 넛지를 받아 해당 유저 채널로 발행(리스너와 분리된 경로). 틱은 broadcast_loop 가 담당."""
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
                await ws_bus.publish_user(user_id, payload)
        except Exception:
            log.exception("fan-out 실패 — skip")
    log.info("fan-out 워커 종료")


async def _handle_tick(raw: str) -> None:
    tick = json.loads(raw)
    ticker = tick["ticker"]
    price = Decimal(str(tick["price"]))
    _store_latest(tick, price)  # 화면 전송은 묶기 루프가 최신 1개만
    # 청산은 모든 틱에서 인라인 검사(정확성 우선). 캐시로 후보만, 후보 있을 때만 DB 확정.
    snap = await position_cache.cache.get(AsyncSessionLocal)
    candidates = liquidation_service.find_candidates(snap.for_ticker(ticker), price)
    if not candidates:
        return
    try:
        async with AsyncSessionLocal() as db:
            results = await liquidation_service.liquidate_candidates(db, candidates, price)
            for r in results:
                _queue_close_nudges(r)  # 인라인 send 금지 — 큐로 위임(랭킹 실패와 무관하게 먼저 적재)
                try:
                    await ranking_service.sync_account_rank(deps.get_redis(), db, r.trade.account_id)
                except Exception:
                    log.warning("랭킹 동기화 실패(청산은 정상 완료) account=%s", r.trade.account_id, exc_info=True)
    finally:
        position_cache.mark_dirty()  # 청산됐든(상태 변경) 이미 닫혔든(캐시 오래됨) 재적재


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

"""주문·청산 거부 문구 — 사용자가 이해할 수 있는 말로(웹·앱이 detail 을 그대로 띄운다)."""
from __future__ import annotations

import json

import pytest
from redis.exceptions import RedisError

from apps.trading_game.routers import orders as orders_router
from apps.trading_game.services import market_clock
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _order, _seed_season, _seed_user, api, closes_stub, fake_redis, maker, order_env,
)

INTERNAL_WORDS = ("시세 수신", "시세 서버", "Redis", "시세 데이터")


def _no_jargon(msg: str) -> None:
    assert not any(w in msg for w in INTERNAL_WORDS), msg


async def test_close_outside_trading_time_says_so(api, maker, order_env, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        user = await _seed_user(db)
    set_user(user)
    r = await client.post("/api/game/orders", json=_order(season.id))
    assert r.status_code == 201, r.text
    monkeypatch.setattr(orders_router.market_clock, "in_trading_window", lambda *a, **k: False)
    res = await client.post(f"/api/game/positions/{r.json()['id']}/close")
    assert res.status_code == 409
    assert res.json()["detail"] == orders_router.MSG_CLOSE_NOT_TRADING_TIME
    _no_jargon(res.json()["detail"])


async def test_open_outside_trading_time_message(api, maker, order_env, monkeypatch):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_user(db))
    monkeypatch.setattr(orders_router.market_clock, "in_trading_window", lambda *a, **k: False)
    res = await client.post("/api/game/orders", json=_order(season.id))
    assert res.status_code == 409 and res.json()["detail"] == orders_router.MSG_NOT_TRADING_TIME


class _Redis:
    def __init__(self, value=None, exc=None):
        self.value, self.exc = value, exc

    async def get(self, key):
        if self.exc:
            raise self.exc
        return self.value


@pytest.mark.parametrize("redis, status, msg", [
    (_Redis(None), 409, "MSG_PRICE_STALE"),                                          # 가격 없음
    (_Redis(json.dumps({"price": 100, "ts": 0})), 409, "MSG_PRICE_STALE"),          # 오래된 가격
    (_Redis("{not json"), 409, "MSG_PRICE_STALE"),                                  # 깨진 데이터
    (_Redis(json.dumps({"price": 100})), 409, "MSG_PRICE_STALE"),                   # ts 없음
    (_Redis(exc=RedisError("down")), 503, "MSG_PRICE_UNAVAILABLE"),                 # 저장소 장애
])
async def test_price_errors_are_user_friendly(redis, status, msg):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e:
        await orders_router._require_fresh_price(redis, "005930")
    assert e.value.status_code == status and e.value.detail == getattr(orders_router, msg)
    _no_jargon(e.value.detail)


async def test_fresh_price_returned(monkeypatch):
    monkeypatch.setattr(market_clock, "now_epoch", lambda: 1000.0)
    price = await orders_router._require_fresh_price(_Redis(json.dumps({"price": 123.5, "ts": 995})), "005930")
    assert str(price) == "123.5"


# ---------------------------------------------------------------- 장운영 상태(VI·거래정지·서킷브레이크·사이드카)
from apps.trading_game.services import market_status as ms  # noqa: E402


async def _set_status(redis, **ev):
    base = {"trht_yn": "N", "vi_cls_code": "N", "ovtm_vi_cls_code": "N", "mkop_cls_code": "", "iscd_stat_cls_code": "00"}
    base.update(ev)
    await ms.save_event(redis, "005930", base, market_clock.now_epoch())


async def test_vi_blocks_open_and_close_with_reason(api, maker, order_env, fake_redis):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_user(db))
    r = await client.post("/api/game/orders", json=_order(season.id))
    assert r.status_code == 201, r.text
    await _set_status(fake_redis, vi_cls_code="Y")
    res = await client.post("/api/game/orders", json=_order(season.id))
    assert res.status_code == 409 and res.json()["detail"] == ms.MESSAGES[ms.VI]
    res = await client.post(f"/api/game/positions/{r.json()['id']}/close")
    assert res.status_code == 409 and "VI" in res.json()["detail"]
    await _set_status(fake_redis, vi_cls_code="N")
    assert (await client.post(f"/api/game/positions/{r.json()['id']}/close")).status_code == 200


async def test_halt_and_circuit_breaker_block_sidecar_does_not(api, maker, order_env, fake_redis):
    client, set_user = api
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_user(db))
    await _set_status(fake_redis, trht_yn="Y", tr_susp_reas_cntt="불성실공시")
    res = await client.post("/api/game/orders", json=_order(season.id))
    assert res.status_code == 409 and "거래가 정지" in res.json()["detail"] and "불성실공시" in res.json()["detail"]
    await _set_status(fake_redis, trht_yn="N", mkop_cls_code="174")
    res = await client.post("/api/game/orders", json=_order(season.id))
    assert res.status_code == 409 and res.json()["detail"] == ms.MESSAGES[ms.CIRCUIT_BREAKER]
    await _set_status(fake_redis, mkop_cls_code="175")
    await _set_status(fake_redis, mkop_cls_code="387")  # 사이드카 — 안내만
    assert (await client.post("/api/game/orders", json=_order(season.id))).status_code == 201


async def test_market_status_endpoint(api, maker, fake_redis):
    client, _ = api
    body = (await client.get("/api/game/market-status")).json()
    assert body["ticker"] is None and body["state"] == "NORMAL" and body["blocking"] is False
    async with maker() as db:
        await _seed_season(db)
    assert (await client.get("/api/game/market-status")).json()["state"] == "NORMAL"
    await _set_status(fake_redis, vi_cls_code="Y")
    body = (await client.get("/api/game/market-status")).json()
    assert body["ticker"] == "005930" and body["state"] == "VI" and body["blocking"] and body["since"]


async def test_listener_relays_status_to_everyone(monkeypatch):
    from apps.trading_game.services import tick_listener, ws_bus

    sent = []

    async def fake_publish_all(msg, redis=None):
        sent.append(msg)

    monkeypatch.setattr(ws_bus, "publish_all", fake_publish_all)
    payload = {"type": "market_status", "ticker": "005930", "state": "VI", "message": "m", "blocking": True, "since": None}
    await tick_listener._relay_status(json.dumps(payload))
    await tick_listener._relay_status(json.dumps({"type": "other"}))
    assert sent == [payload]

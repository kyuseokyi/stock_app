"""부분 익절·원금 회수 — POST /api/game/positions/{id}/close 본문 portion (2026-10-28 설계 §2·§5)."""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select

from shared.game_models import GameAccount, GamePosition, GameTrade
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _order, _seed_season, _seed_user, api, closes_stub, fake_redis, maker, order_env,
)


async def _open(client, maker, set_user, **order):
    """시즌·유저 준비 후 진입(비중 50% → 원금 500만 원, 진입가 100). 포지션 id 반환."""
    async with maker() as db:
        season = await _seed_season(db)
        set_user(await _seed_user(db))
    r = await client.post("/api/game/orders", json=_order(season.id, **order))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _account(maker) -> GameAccount:
    async with maker() as db:
        return (await db.execute(select(GameAccount))).scalar_one()


async def test_close_without_body_is_full_close(api, maker, order_env):
    """옛 앱은 본문 없이 보낸다 — 전량 청산(기존 동작)."""
    client, set_user = api
    pid = await _open(client, maker, set_user)
    order_env["v"] = Decimal("110")
    res = await client.post(f"/api/game/positions/{pid}/close")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "CLOSED"
    assert Decimal(body["size_amount"]) == Decimal("5000000")
    assert Decimal(body["realized_pnl"]) == Decimal("498500")
    assert Decimal(body["returned_amount"]) == Decimal("5498500")
    acc = await _account(maker)
    assert (acc.total_trades, acc.win_trades) == (1, 1)


async def test_close_with_empty_body_or_all_is_full_close(api, maker, order_env):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    res = await client.post(f"/api/game/positions/{pid}/close", json={})
    assert res.status_code == 200 and res.json()["status"] == "CLOSED"

    async with maker() as db:  # 두 번째 포지션(같은 계좌)
        acc = (await db.execute(select(GameAccount))).scalar_one()
    r = await client.post("/api/game/orders", json=_order(acc.season_id))
    res = await client.post(f"/api/game/positions/{r.json()['id']}/close", json={"portion": "all"})
    assert res.status_code == 200 and res.json()["status"] == "CLOSED"


async def test_close_half_keeps_remaining_position(api, maker, order_env):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    order_env["v"] = Decimal("110")
    res = await client.post(f"/api/game/positions/{pid}/close", json={"portion": "half"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == pid and body["status"] == "OPEN"
    assert Decimal(body["size_amount"]) == Decimal("2500000")
    assert Decimal(body["roi_pct"]) == Decimal("9.97")
    assert Decimal(body["pnl_amount"]) == Decimal("249250")  # 남은 포지션 평가
    assert Decimal(body["realized_pnl"]) == Decimal("249250")
    assert Decimal(body["returned_amount"]) == Decimal("2749250")
    assert [n["code"] for n in body["nudges"]] == ["PARTIAL_TAKE_PROFIT"]

    acc = await _account(maker)
    assert acc.cash_balance == Decimal("7749250")  # 남은 현금 500만 + 274.925만
    assert acc.total_asset == Decimal("7749250") + Decimal("2500000") + Decimal("249250")
    assert acc.current_roi == Decimal("4.9850")
    assert (acc.total_trades, acc.win_trades) == (0, 0)
    async with maker() as db:
        trades = (await db.execute(select(GameTrade))).scalars().all()
    assert [(t.closed_reason, t.size_amount) for t in trades] == [("PARTIAL_TP", Decimal("2500000"))]

    # 남은 포지션은 /positions/active 에 그대로 보이고, 이어서 전량 청산 가능
    res = await client.post(f"/api/game/positions/{pid}/close")
    assert res.status_code == 200 and res.json()["status"] == "CLOSED"
    acc = await _account(maker)
    assert (acc.total_trades, acc.win_trades) == (1, 1)


async def test_close_principal_returns_principal(api, maker, order_env, fake_redis):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    order_env["v"] = Decimal("110")
    res = await client.post(f"/api/game/positions/{pid}/close", json={"portion": "principal"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "OPEN"
    assert abs(Decimal(body["returned_amount"]) - Decimal("5000000")) <= Decimal("0.02")
    remaining_value = Decimal(body["size_amount"]) + Decimal(body["pnl_amount"])
    assert abs(remaining_value - Decimal("498500")) <= Decimal("0.02")  # 남은 평가금 = 수익금
    assert [n["code"] for n in body["nudges"]] == ["PRINCIPAL_SECURED"]
    async with maker() as db:
        pos = await db.get(GamePosition, uuid.UUID(pid))
        assert pos.status == "OPEN" and pos.size_amount == Decimal(body["size_amount"])
    # 랭킹 동기화 — 부분 청산 직후에도 평가 반영 ROI(전량 보유 때와 같은 4.985%)
    acc = await _account(maker)
    score = await fake_redis.zscore(f"game:season:{acc.season_id}:ranking", str(acc.user_id))
    assert abs(Decimal(str(score)) - Decimal("4.985")) <= Decimal("0.0002")


async def test_partial_close_in_loss_is_409(api, maker, order_env):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    order_env["v"] = Decimal("95")
    for portion in ("half", "principal"):
        res = await client.post(f"/api/game/positions/{pid}/close", json={"portion": portion})
        assert res.status_code == 409
        assert res.json()["detail"] == "수익 중일 때만 부분 익절할 수 있어요."
    async with maker() as db:
        assert (await db.execute(select(GameTrade))).scalars().all() == []


async def test_partial_close_on_closed_position_is_409(api, maker, order_env):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    order_env["v"] = Decimal("110")
    assert (await client.post(f"/api/game/positions/{pid}/close")).status_code == 200
    res = await client.post(f"/api/game/positions/{pid}/close", json={"portion": "half"})
    assert res.status_code == 409 and res.json()["detail"] == "이미 청산된 포지션입니다."


async def test_invalid_portion_is_422(api, maker, order_env):
    client, set_user = api
    pid = await _open(client, maker, set_user)
    res = await client.post(f"/api/game/positions/{pid}/close", json={"portion": "quarter"})
    assert res.status_code == 422


async def test_rules_expose_partial_close(api):
    client, _ = api
    body = (await client.get("/api/game/rules")).json()
    assert body["partial_close"] is True

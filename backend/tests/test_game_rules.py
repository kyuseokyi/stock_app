"""규칙 API(/api/game/rules)·베팅 심리 total·사용자 노출 방향 용어 테스트."""
from __future__ import annotations

from decimal import Decimal

import httpx
import pytest

from shared.database import get_db
from shared.game_models import GamePosition
from apps.trading_game.main import app
from apps.trading_game.routers import ws_gateway
from apps.trading_game.services import (
    academy_service, connection_manager, order_engine, pricing, quest_service,
)
from shared import game_models
from tests.test_quest_quiz_streak import (  # noqa: F401 — 픽스처 재사용
    _seed_account, _seed_season, _seed_user, maker,
)


@pytest.fixture
async def anon(maker):
    """인증 의존성 오버라이드 없이 get_db 만 교체한 비로그인 클라이언트."""
    async def _db():
        async with maker() as s:
            yield s

    app.dependency_overrides[get_db] = _db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


async def test_rules_public_and_values_equal_constants(anon, monkeypatch):
    monkeypatch.delenv("TRADING_WINDOWS", raising=False)
    res = await anon.get("/api/game/rules")  # Authorization 헤더 없음
    assert res.status_code == 200
    assert res.json() == {
        "initial_cash": int(game_models.INITIAL_CASH),
        "min_order_amount": int(order_engine.MIN_ORDER_AMOUNT),
        "max_open_positions": order_engine.MAX_OPEN_POSITIONS,
        "partial_close": True,
        "trading_windows": [["09:00", "15:30"], ["16:00", "20:00"]],
        "leverages": [1, 2, 5],
        "leverage_unlock": {"5": "academy"},
        "fee_roundtrip_pct": float(pricing.FEE_ROUNDTRIP_PCT),
        "margin_call_roi_pct": int(pricing.MARGIN_CALL_ROI_PCT),
        "sentiment_interval_sec": int(connection_manager.SENTIMENT_INTERVAL),
        "rewards": {"weekly": [500000, 300000, 200000], "monthly": [1500000, 900000, 600000],
                    "streak": {"3": 100000, "7": 300000, "14": 700000, "30": 2000000}},
        "chart_interval_default": "day",
        "chart_intervals": ["day", "1m", "5m", "15m", "60m"],
    }
    # 스펙 예시 값과도 일치(상수 회귀 감지)
    body = res.json()
    assert (body["initial_cash"], body["min_order_amount"], body["fee_roundtrip_pct"],
            body["margin_call_roi_pct"], body["sentiment_interval_sec"]) == (10000000, 100000, 0.03, -80, 5)


async def test_rules_follow_constants(anon, monkeypatch):
    monkeypatch.setattr(pricing, "FEE_ROUNDTRIP_PCT", Decimal("0.05"))
    monkeypatch.setattr(pricing, "MARGIN_CALL_ROI_PCT", Decimal("-70"))
    monkeypatch.setattr(order_engine, "MIN_ORDER_AMOUNT", Decimal("50000"))
    monkeypatch.setattr(game_models, "INITIAL_CASH", Decimal("20000000"))
    monkeypatch.setattr(connection_manager, "SENTIMENT_INTERVAL", 10.0)
    monkeypatch.setattr(academy_service, "ACADEMY_LEVERAGE", 2)
    monkeypatch.setenv("TRADING_WINDOWS", "09:00-15:30")
    body = (await anon.get("/api/game/rules")).json()
    assert body["fee_roundtrip_pct"] == 0.05
    assert body["margin_call_roi_pct"] == -70
    assert body["min_order_amount"] == 50000
    assert body["initial_cash"] == 20000000
    assert body["sentiment_interval_sec"] == 10
    assert body["leverage_unlock"] == {"2": "academy"}
    assert body["trading_windows"] == [["09:00", "15:30"]]


async def test_rules_rewards_equal_reward_config(anon):
    rules = (await anon.get("/api/game/rules")).json()
    cfg = (await anon.get("/api/game/reward-config")).json()
    assert rules["rewards"] == cfg


async def test_rules_chart_interval_follows_settings(anon, maker):
    from apps.trading_game.services import game_settings_service as gss

    async with maker() as db:
        await gss.update_settings(db, {"chart_interval_default": "5m"})
    body = (await anon.get("/api/game/rules")).json()
    assert body["chart_interval_default"] == "5m"
    assert body["chart_intervals"] == ["day", "1m", "5m", "15m", "60m"]


def test_sentiment_interval_shared_with_ws_gateway():
    assert ws_gateway.SENTIMENT_INTERVAL == connection_manager.SENTIMENT_INTERVAL


async def test_collect_sentiment_includes_total(maker, monkeypatch):
    async with maker() as db:
        season = await _seed_season(db)
        for i, side in enumerate(("LONG", "LONG", "SHORT")):
            u = await _seed_user(db, nickname=f"p{i}")
            acc = await _seed_account(db, u, season)
            db.add(GamePosition(account_id=acc.id, side=side, entry_price=Decimal("1"),
                                size_amount=Decimal("1"), leverage=1, status="OPEN"))
        await db.commit()
    monkeypatch.setattr(ws_gateway, "AsyncSessionLocal", maker)
    msg = await ws_gateway._collect_sentiment()
    assert msg == {"type": "sentiment", "long_pct": 66.7, "short_pct": 33.3, "total": 3}


def test_quest_texts_use_korean_side_terms():
    for q in quest_service.QUESTS:
        for text in (q.title, q.description):
            assert not any(w in text for w in ("LONG", "SHORT", "Long", "Short", "롱", "숏"))

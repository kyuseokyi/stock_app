"""오늘 특징주 — 52주 신고가·신저가 판정(순수 계산)·Redis 스냅숏·파이프라인 태스크. CH·PG 는 가짜."""
from __future__ import annotations

from datetime import date, timedelta

import fakeredis
import pytest

from apps.collector.screener import featured
from apps.collector.screener import indicators as ind
from apps.collector.tasks import featured as task
from shared import featured_store

AS_OF = date(2026, 11, 16)


def _bars(n: int, *, high=100.0, low=90.0, close=95.0, last=None, as_of=AS_OF) -> list[tuple]:
    """n 개 봉(오래된 → 최신, 마지막 = as_of). last=(high, low, close) 로 당일 봉만 바꾼다."""
    out = []
    for i in range(n):
        d = as_of - timedelta(days=n - 1 - i)
        out.append((d, high, low, close, 1000.0))
    if last is not None:
        h, lo, c = last
        out[-1] = (as_of, h, lo, c, 1000.0)
    return out


# ---------------------------------------------------------------- 지표
def test_prev_low_mirrors_prev_high():
    lows = [float(x) for x in range(300, 0, -1)]  # 300 → 1
    assert ind.prev_low(lows) == min(lows[-252:-1])
    assert ind.prev_low(lows[:251]) is None  # 252 미만이면 계산 안 함
    assert ind.prev_low(lows[:252]) == min(lows[:251])


def test_prev_low_ignores_non_positive_and_all_zero():
    lows = [50.0] * 251 + [40.0]
    lows[10] = 0.0  # 거래정지일 0 봉이 끼어도 신저가가 영영 불가능해지지 않게
    assert ind.prev_low(lows) == 50.0
    assert ind.prev_low([0.0] * 252) is None


# ---------------------------------------------------------------- 판정
def test_new_high_boundary_strict_greater():
    uni = [("000001", "가", "KOSPI"), ("000002", "나", "KOSPI")]
    bars = {"000001": _bars(252, last=(100.01, 95.0, 100.0)),  # 직전 최고 100 초과 → 신고가
            "000002": _bars(252, last=(100.0, 95.0, 99.0))}    # 같으면 아님
    snap = featured.compute(AS_OF, uni, bars)
    assert [x["ticker"] for x in snap["highs"]["items"]] == ["000001"]
    assert snap["highs"]["count"] == 1 and snap["lows"]["count"] == 0
    item = snap["highs"]["items"][0]
    assert item == {"ticker": "000001", "name": "가", "market": "KOSPI", "close": 100.0,
                    "change_rate": pytest.approx(5.26, abs=0.01), "high": 100.01, "low": 95.0,
                    "prev_high_52w": 100.0, "prev_low_52w": 90.0}


def test_new_low_boundary_strict_less():
    uni = [("000001", "가", "KOSDAQ"), ("000002", "나", "KOSDAQ")]
    bars = {"000001": _bars(252, last=(92.0, 89.99, 90.0)),  # 직전 최저 90 미만 → 신저가
            "000002": _bars(252, last=(92.0, 90.0, 91.0))}   # 같으면 아님
    snap = featured.compute(AS_OF, uni, bars)
    assert [x["ticker"] for x in snap["lows"]["items"]] == ["000001"]
    assert snap["highs"]["count"] == 0


def test_excludes_under_252_bars_and_missing_today_bar_and_out_of_universe():
    uni = [("000001", "짧음", "KOSPI"), ("000002", "오늘봉없음", "KOSPI"), ("000003", "정상", "KOSPI")]
    bars = {"000001": _bars(251, last=(200.0, 95.0, 150.0)),
            "000002": _bars(252, last=(200.0, 95.0, 150.0), as_of=AS_OF - timedelta(days=1)),
            "000003": _bars(300, last=(200.0, 95.0, 150.0)),
            "999999": _bars(300, last=(200.0, 95.0, 150.0))}  # 유니버스 밖(ETF 등) — 무시
    snap = featured.compute(AS_OF, uni, bars)
    assert [x["ticker"] for x in snap["highs"]["items"]] == ["000003"]
    assert snap["eligible"] == 1


def test_sort_and_top_n():
    uni = [(f"{i:06d}", f"종목{i}", "KOSPI") for i in range(1, 6)]
    # 신고가 5종목 — 등락률이 다르게(전일 종가 95 고정, 당일 종가로 조절)
    closes = {1: 101.0, 2: 130.0, 3: 110.0, 4: 120.0, 5: 105.0}
    bars = {t: _bars(252, last=(140.0, 95.0, closes[int(t)])) for t, _, _ in uni}
    snap = featured.compute(AS_OF, uni, bars, top_n=3)
    assert snap["highs"]["count"] == 5
    assert [x["ticker"] for x in snap["highs"]["items"]] == ["000002", "000004", "000003"]
    # 신저가는 오름차순(가장 많이 빠진 것 먼저)
    lows = {1: 80.0, 2: 70.0, 3: 85.0}
    uni2 = [(f"{i:06d}", f"종목{i}", "KOSPI") for i in range(1, 4)]
    bars2 = {t: _bars(252, last=(96.0, 60.0, lows[int(t)])) for t, _, _ in uni2}
    snap2 = featured.compute(AS_OF, uni2, bars2, top_n=2)
    assert snap2["lows"]["count"] == 3
    assert [x["ticker"] for x in snap2["lows"]["items"]] == ["000002", "000001"]


def test_snapshot_shape():
    snap = featured.compute(AS_OF, [], {})
    assert snap["date"] == "2026-11-16"
    assert snap["highs"] == {"count": 0, "items": []} and snap["lows"] == {"count": 0, "items": []}
    assert snap["eligible"] == 0


# ---------------------------------------------------------------- 저장
def test_store_roundtrip_and_ttl():
    r = fakeredis.FakeRedis(decode_responses=True)
    assert featured_store.load_highs(r) is None
    featured_store.save_highs(r, {"date": "2026-11-16", "highs": {"count": 0, "items": []},
                                  "lows": {"count": 0, "items": []}})
    assert featured_store.load_highs(r)["date"] == "2026-11-16"
    assert r.ttl(featured_store.HIGHS_KEY) >= 10 * 24 * 3600  # 긴 연휴에도 카드가 비지 않게
    r.set(featured_store.HIGHS_KEY, "{깨짐")
    assert featured_store.load_highs(r) is None


# ---------------------------------------------------------------- 태스크
@pytest.fixture
def env(monkeypatch):
    fake = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(task, "get_sync_redis", lambda: fake)
    monkeypatch.setattr(task, "_universe", lambda: [("000001", "가", "KOSPI")])
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: AS_OF)
    return fake


def test_task_saves_snapshot(env, monkeypatch):
    seen = {}

    def load_bars(d, tickers=None):
        seen["d"], seen["tickers"] = d, tickers
        return {"000001": _bars(252, last=(120.0, 95.0, 110.0))}

    monkeypatch.setattr(task.cs, "load_bars", load_bars)
    out = task.compute_featured_highs()
    assert out == {"date": "2026-11-16", "highs": 1, "lows": 0, "eligible": 1}
    assert seen == {"d": AS_OF, "tickers": ["000001"]}
    assert featured_store.load_highs(env)["highs"]["items"][0]["ticker"] == "000001"


def test_task_keeps_previous_snapshot_when_nothing_eligible(env, monkeypatch):
    featured_store.save_highs(env, {"date": "2026-11-13", "highs": {"count": 1, "items": []},
                                    "lows": {"count": 0, "items": []}})
    monkeypatch.setattr(task.cs, "load_bars", lambda d, tickers=None: {})
    out = task.compute_featured_highs()
    assert "error" in out
    assert featured_store.load_highs(env)["date"] == "2026-11-13"


def test_task_skips_without_bars(env, monkeypatch):
    monkeypatch.setattr(task.cs, "latest_trading_date", lambda: None)
    assert task.compute_featured_highs() == {"skipped": "일봉 없음"}


def test_task_registered():
    from apps.collector.celery_app import celery_app

    assert task.compute_featured_highs.name == "collector.compute_featured_highs"
    assert "apps.collector.tasks.featured" in celery_app.conf.include

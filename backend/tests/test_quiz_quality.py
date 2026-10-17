"""차트 퀴즈 자동 생성 품질 기준(B1) — 신호 감지·3% 등락·20거래일 간격·거래대금·정답 비율(실 CH 미사용)."""
from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from shared.game_models import ChartQuiz
from scripts import generate_chart_quiz as gen
from tests.test_quest_quiz_streak import maker  # noqa: F401 — 픽스처 재사용


def rich_candles(n: int = 400, *, seed: int = 1, start: date = date(2024, 1, 1), volume: float = 1_000_000) -> list[dict]:
    """일 ±4% 안쪽 랜덤워크(종가 ~1만 원·거래량 100만 → 거래대금 ~100억). 신호·3% 등락이 자주 나온다."""
    rng = random.Random(seed)
    close, out = 10_000.0, []
    for i in range(n):
        close *= 1 + rng.uniform(-0.04, 0.04)
        vol = volume * (3 if rng.random() < 0.05 else 1)
        out.append({"date": (start + timedelta(days=i)).isoformat(), "open": close, "high": close,
                    "low": close, "close": close, "volume": vol})
    return out


def _flat(closes: list[float], volumes: list[float] | None = None) -> list[dict]:
    volumes = volumes or [1_000_000.0] * len(closes)
    return [
        {"date": (date(2026, 1, 1) + timedelta(days=i)).isoformat(), "open": c, "high": c, "low": c,
         "close": c, "volume": v}
        for i, (c, v) in enumerate(zip(closes, volumes))
    ]


# ---------------------------------------------------------------- detect_signal
def test_detect_signal_none_on_flat():
    assert gen.detect_signal(_flat([100.0] * 60)) is None


def test_detect_signal_crosses():
    assert gen.detect_signal(_flat([100.0] * 59 + [110.0])) == "GOLDEN_CROSS"
    assert gen.detect_signal(_flat([100.0] * 59 + [90.0])) == "DEAD_CROSS"


def test_detect_signal_breakout_and_breakdown():
    # 5일선이 이미 20일선 위(교차 아님)에서 직전 20일 최고 종가 돌파
    up = [100.0] * 30 + [float(100 + i) for i in range(1, 30)] + [140.0]
    assert gen.detect_signal(_flat(up)) == "BREAKOUT_HIGH"
    down = [200.0] * 30 + [float(200 - i) for i in range(1, 30)] + [160.0]
    assert gen.detect_signal(_flat(down)) == "BREAKDOWN_LOW"


def test_detect_signal_volume_surge():
    # 5봉 주기 박스권 — 5일선=20일선(교차 없음)·마지막 봉은 범위 안·RSI 중립
    closes = [100.0, 102.0, 101.0, 103.0, 101.0] * 12
    vols = [1_000_000.0] * 59 + [2_500_000.0]
    assert gen.detect_signal(_flat(closes, vols)) == "VOLUME_SURGE"
    assert gen.detect_signal(_flat(closes)) is None


def test_detect_signal_rsi_overbought():
    # 꾸준한 상승 뒤 보합 — 신고가·교차는 아니지만 RSI 는 아직 70 이상
    closes = [100.0 + i for i in range(50)] + [149.0, 148.5, 149.0, 148.8, 149.0, 148.9, 149.0, 148.9, 149.0, 148.0]
    assert gen.detect_signal(_flat(closes)) == "RSI_OVERBOUGHT"


def test_detect_signal_short_series():
    assert gen.detect_signal(_flat([100.0] * 20)) is None


def test_signal_ignores_future_candles():
    """기준일 뒤 봉(정답 봉 제외)의 종가·거래량을 바꾸고 이후 봉을 잘라도 그 기준일의 판정은 같다(미래 정보 누수 금지)."""
    candles = rich_candles(300, seed=7)
    base = gen.eligible_quizzes("005930", candles)
    assert base
    for idx, q in base[:10]:
        mutated = [dict(c) for c in candles[:idx + gen.HORIZON + 1]]
        for c in mutated[idx + 1:idx + gen.HORIZON]:
            c["volume"] *= 50
            c["close"] = c["open"] = c["high"] = c["low"] = float(candles[idx]["close"])
        again = dict(gen.eligible_quizzes("005930", mutated))
        assert idx in again and again[idx]["pattern_type"] == q["pattern_type"]
        assert again[idx]["answer"] == q["answer"]


# ---------------------------------------------------------------- 거래대금·등락 기준
def test_avg_turnover_handles_missing_volume():
    rows = _flat([10_000.0] * 20)
    rows[0]["volume"] = None
    assert gen.avg_turnover(rows) == pytest.approx(10_000 * 1_000_000 * 19 / 20)


def test_eligible_quizzes_rules():
    candles = rich_candles(400, seed=3)
    found = gen.eligible_quizzes("005930", candles)
    assert found
    for idx, q in found:
        assert abs(q["actual_change"]) >= Decimal("3")
        window = candles[idx - gen.WINDOW + 1:idx + 1]
        assert gen.detect_signal(window) is not None
        assert gen.avg_turnover(window) >= gen.MIN_TURNOVER
        assert q["base_date"] == date.fromisoformat(candles[idx]["date"])
        assert q["pattern_type"] in {label for label, _ in gen.SIGNALS.values()}


def test_eligible_quizzes_skips_illiquid():
    assert gen.eligible_quizzes("005930", rich_candles(400, seed=3, volume=100)) == []


def test_explanation_mentions_signal():
    _, md = gen.build_explanation([100.0] * 60, "VOLUME_SURGE")
    assert md.startswith("### 거래량 급증") and "신호:" in md and "RSI(14)" in md


def test_direct_create_keeps_one_percent_rule():
    """관리자 직접 출제(evaluate_quiz 기본값)는 신호·거래대금·3% 기준을 적용하지 않는다."""
    q = gen.evaluate_quiz("005930", _flat([100.0] * 64 + [101.5], [100.0] * 65), 59)
    assert isinstance(q, dict) and q["actual_change"] == Decimal("1.50")


# ---------------------------------------------------------------- collect_quizzes
def _collect(count, *, tickers=("A", "B", "C", "D"), existing=None, seed=0):
    data = {t: rich_candles(500, seed=i + 10) for i, t in enumerate(tickers)}
    return gen.collect_quizzes(count, rng=random.Random(seed), fetch_tickers=lambda: list(tickers),
                               fetch_candles=lambda t: data[t], existing=existing), data


def test_collect_gap_per_ticker_and_limits():
    quizzes, data = _collect(8)
    assert len(quizzes) == 8
    by_ticker: dict[str, list[int]] = {}
    for q in quizzes:
        keys = [c["date"] for c in data[q["ticker"]]]
        by_ticker.setdefault(q["ticker"], []).append(keys.index(q["base_date"].isoformat()))
    for idxs in by_ticker.values():
        assert len(idxs) <= gen.PER_TICKER_MAX
        idxs.sort()
        assert all(b - a >= gen.MIN_GAP_BARS for a, b in zip(idxs, idxs[1:]))


def test_collect_balances_answers():
    quizzes, _ = _collect(8)
    ups = sum(q["answer"] == "UP" for q in quizzes)
    assert ups == 4 and len(quizzes) - ups == 4


def test_collect_spreads_patterns():
    """적게 나온 패턴을 먼저 고른다 — 한 패턴이 몰리지 않는다."""
    import collections

    quizzes, _ = _collect(12, tickers=tuple("ABCDEFGH"))
    counts = collections.Counter(q["pattern_type"] for q in quizzes)
    assert len(quizzes) == 12 and len(counts) >= 4 and max(counts.values()) <= 4


def test_collect_respects_existing_quizzes():
    _, data = _collect(1, tickers=("A",))
    candidates = gen.eligible_quizzes("A", data["A"])
    # 모든 후보 기준일을 기존 문제로 두면 간격 규칙에 걸려 아무것도 고르지 않는다
    existing = {"A": [q["base_date"] for _, q in candidates]}
    quizzes, _ = _collect(5, tickers=("A",), existing=existing)
    assert quizzes == []


def test_collect_bounded_fetches(monkeypatch):
    monkeypatch.setattr(gen, "MAX_TICKER_FETCHES", 3)
    calls: list[str] = []

    def fetch(t):
        calls.append(t)
        return []

    assert gen.collect_quizzes(10, rng=random.Random(0), fetch_tickers=lambda: [f"T{i}" for i in range(50)],
                               fetch_candles=fetch) == []
    assert len(calls) == 3


async def test_generate_keeps_gap_from_db_rows(maker):  # noqa: F811
    candles = rich_candles(500, seed=10)
    kw = dict(fetch_tickers=lambda: ["005930"], fetch_candles=lambda t: candles, session_factory=maker)
    created, _ = await gen.generate(2, rng=random.Random(0), **kw)
    assert created == 2
    await gen.generate(2, rng=random.Random(1), **kw)  # 두 번째 실행도 기존 문제와 20거래일 이상 떨어져야 한다
    async with maker() as db:
        rows = (await db.execute(select(ChartQuiz.base_date))).scalars().all()
    assert len(rows) >= 3
    keys = [c["date"] for c in candles]
    idxs = sorted(keys.index(d.isoformat()) for d in rows)
    assert all(b - a >= gen.MIN_GAP_BARS for a, b in zip(idxs, idxs[1:]))

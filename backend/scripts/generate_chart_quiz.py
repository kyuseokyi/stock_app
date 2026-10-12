"""야간 차트 퀴즈 자동 생성 (Phase 5b, 멱등).

ClickHouse daily_prices 에서 종목·기준일을 무작위로 골라 기준일까지 60봉을 문제로,
이후 5봉 종가 변동률로 정답(UP/DOWN)을 정한다. |변동률| < 1% 인 애매한 구간은 버린다.
해설은 기준일 RSI(14)·5/20일 이동평균 상태로 만든 규칙 기반 템플릿.
(ticker, base_date) 가 이미 있으면 건너뛰므로 재실행해도 중복이 생기지 않는다.

실행:
    cd backend
    uv run python -m scripts.generate_chart_quiz --count 50 [--seed 42]

주의: 운영 DB에는 실행하지 말 것. 로컬/개발 DB에서만 사용한다.
"""
from __future__ import annotations

import argparse
import asyncio
import random
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from sqlalchemy import select

from shared.database import AsyncSessionLocal
from shared.game_models import ChartQuiz
from apps.trading_game.services import indicators, rsi_service

WINDOW = 60
HORIZON = 5
MIN_ABS_CHANGE = 1.0
LOOKBACK_DAYS = 3 * 365
MAX_DAILY_MOVE = 0.30  # KRX 가격제한폭


def _valid_series(closes: list[float]) -> bool:
    """종가열이 퀴즈로 쓸 만한지 검사한다.

    종가가 0 이하인 값이 있거나(결측·데이터 오류), 연속 종가 간 변동이
    가격제한폭(MAX_DAILY_MOVE)을 넘으면(미반영 분할 등 가짜 급등락) False.
    """
    if any(c <= 0 for c in closes):
        return False
    return all(abs(closes[i] / closes[i - 1] - 1) <= MAX_DAILY_MOVE for i in range(1, len(closes)))


def _avg(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def build_explanation(closes: list[float]) -> tuple[str, str]:
    """기준일까지 종가 → (pattern_type, 해설 마크다운)."""
    ma5, ma20 = _avg(closes[-5:]), _avg(closes[-20:])
    rsi = rsi_service.wilder_rsi(closes)
    if indicators.golden_cross_within(closes):
        pattern, ma_desc = "골든크로스", "5일선이 20일선을 막 상향 돌파했습니다. 단기 상승 전환 신호로 자주 해석됩니다."
    elif indicators.golden_cross_within([-c for c in closes]):  # 부호 반전 = 데드크로스
        pattern, ma_desc = "데드크로스", "5일선이 20일선을 막 하향 돌파했습니다. 단기 하락 전환 신호로 자주 해석됩니다."
    elif ma5 > ma20:
        pattern, ma_desc = "정배열", "5일선이 20일선 위에 있어 단기 추세가 우상향입니다."
    else:
        pattern, ma_desc = "역배열", "5일선이 20일선 아래에 있어 단기 추세가 약합니다."
    if rsi is None:
        rsi_text, rsi_desc = "-", "데이터가 부족해 RSI를 계산하지 못했습니다."
    elif rsi >= 70:
        rsi_text, rsi_desc = f"{rsi:.1f}", "과매수 구간 — 추격 매수는 되돌림 위험이 큽니다."
    elif rsi <= 30:
        rsi_text, rsi_desc = f"{rsi:.1f}", "과매도 구간 — 기술적 반등이 나올 수 있는 자리입니다."
    else:
        rsi_text, rsi_desc = f"{rsi:.1f}", "중립 구간입니다."
    md = (
        f"### {pattern}\n"
        f"- 5일선 {ma5:,.0f} / 20일선 {ma20:,.0f}: {ma_desc}\n"
        f"- RSI(14) {rsi_text}: {rsi_desc}\n\n"
        "> 패턴은 확률일 뿐 확정이 아닙니다. 손절 원칙과 함께 활용하세요."
    )
    return pattern, md


def make_quiz(ticker: str, candles: list[dict], base_idx: int) -> dict | None:
    """candles[base_idx] 를 기준일로 퀴즈 1개. 조건 미달이면 None."""
    if base_idx < WINDOW - 1 or base_idx + HORIZON >= len(candles):
        return None
    window = candles[base_idx - WINDOW + 1:base_idx + 1]
    span = candles[base_idx - WINDOW + 1:base_idx + HORIZON + 1]
    if not _valid_series([float(c["close"]) for c in span]):
        return None
    base_close = float(candles[base_idx]["close"])
    future_close = float(candles[base_idx + HORIZON]["close"])
    change = round((future_close - base_close) / base_close * 100, 2)
    if abs(change) < MIN_ABS_CHANGE:
        return None
    pattern, explanation = build_explanation([float(c["close"]) for c in window])
    return {
        "ticker": ticker,
        "base_date": date.fromisoformat(str(candles[base_idx]["date"])[:10]),
        "pattern_type": pattern,
        "chart_snapshot": window,
        "answer": "UP" if change > 0 else "DOWN",
        "actual_change": Decimal(f"{change:.2f}"),
        "explanation": explanation,
    }


def _fetch_tickers() -> list[str]:
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

    rows = get_client().query(f"SELECT DISTINCT ticker FROM {CLICKHOUSE_DB}.daily_prices FINAL").result_rows
    return [r[0] for r in rows]


def _fetch_candles(ticker: str) -> list[dict]:
    # 의도적 cross-app import(rsi_service 와 같은 선례), 지연 import
    from apps.stock_api.services import clickhouse_source

    end = date.today()
    start = end - timedelta(days=LOOKBACK_DAYS)
    candles = clickhouse_source.get_candles(ticker, start.isoformat(), end.isoformat()) or []
    return [
        {"date": str(c.date)[:10], "open": c.open, "high": c.high, "low": c.low, "close": c.close, "volume": c.volume}
        for c in candles
    ]


async def insert_quizzes(db, quizzes: list[dict]) -> tuple[int, int]:
    created = skipped = 0
    for q in quizzes:
        exists = (
            await db.execute(
                select(ChartQuiz.id).where(ChartQuiz.ticker == q["ticker"], ChartQuiz.base_date == q["base_date"])
            )
        ).scalar_one_or_none()
        if exists is not None:
            skipped += 1
            continue
        db.add(ChartQuiz(**q))
        created += 1
    await db.commit()
    return created, skipped


async def generate(
    count: int,
    *,
    rng: random.Random,
    fetch_tickers: Callable[[], list[str]] = _fetch_tickers,
    fetch_candles: Callable[[str], list[dict]] = _fetch_candles,
    session_factory=AsyncSessionLocal,
) -> tuple[int, int]:
    tickers = fetch_tickers()
    cache: dict[str, list[dict]] = {}
    quizzes: list[dict] = []
    seen: set[tuple[str, date]] = set()
    empty_tickers: set[str] = set()
    tries = 0
    while tickers and len(quizzes) < count and tries < count * 20:
        tries += 1
        t = rng.choice(tickers)
        if t not in cache:
            cache[t] = fetch_candles(t)
        candles = cache[t]
        if not candles:
            empty_tickers.add(t)
        if len(candles) < WINDOW + HORIZON:
            continue
        q = make_quiz(t, candles, rng.randint(WINDOW - 1, len(candles) - HORIZON - 1))
        if q is None or (t, q["base_date"]) in seen:
            continue
        seen.add((t, q["base_date"]))
        quizzes.append(q)
    if empty_tickers:
        print(f"[generate_chart_quiz] 캔들 없음(CH 장애/미수집 가능) 종목 수={len(empty_tickers)}")
    async with session_factory() as db:
        return await insert_quizzes(db, quizzes)


def main() -> None:
    parser = argparse.ArgumentParser(description="야간 차트 퀴즈 자동 생성")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()
    created, skipped = asyncio.run(generate(args.count, rng=random.Random(args.seed)))
    print(f"[generate_chart_quiz] created={created}, skipped(duplicate)={skipped}")


if __name__ == "__main__":
    main()

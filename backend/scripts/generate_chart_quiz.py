"""야간 차트 퀴즈 자동 생성 (Phase 5b, 멱등).

ClickHouse daily_prices 에서 종목을 무작위로 골라, 기준일까지 60봉을 문제로·이후 5봉 종가 변동률로
정답(UP/DOWN)을 정한다. 해설은 기준일 RSI(14)·5/20일 이동평균 상태로 만든 규칙 기반 템플릿.
(ticker, base_date) 가 이미 있으면 건너뛰므로 재실행해도 중복이 생기지 않는다.

자동 생성(collect_quizzes)은 품질 기준을 추가로 적용한다(B1):
- 기준일에 신호(이동평균 교차·20일 신고가/신저가·거래량 급증·RSI 과열/과매도)가 나타난 날만
- |변동률| >= AUTO_MIN_ABS_CHANGE(3%) — 관리자 직접 출제(evaluate_quiz)는 기존 1% 기준 유지
- 같은 종목은 기준일 간격 >= MIN_GAP_BARS(20거래일) — DB 의 기존 문제와도 비교
- 기준일까지 20일 평균 거래대금 >= MIN_TURNOVER(10억 원)
- 정답 UP/DOWN 을 반반에 가깝게

실행:
    cd backend
    uv run python -m scripts.generate_chart_quiz --count 50 [--seed 42]

주의: 운영 DB에는 실행하지 말 것. 로컬/개발 DB에서만 사용한다.
"""
from __future__ import annotations

import argparse
import asyncio
import bisect
import collections
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

# 자동 생성 품질 기준(B1)
AUTO_MIN_ABS_CHANGE = 3.0
MIN_GAP_BARS = 20
MIN_TURNOVER = 1_000_000_000  # 20일 평균 거래대금(종가×거래량, 원)
SIGNAL_LOOKBACK = 20
VOLUME_SURGE_RATIO = 2.0
MAX_TICKER_FETCHES = 400  # 한 번 실행에서 CH 일봉 조회 상한(종목 수)

# 신호 → (pattern_type, 해설 한 줄). 우선순위 순서(앞이 먼저 채택)
SIGNALS: dict[str, tuple[str, str]] = {
    "GOLDEN_CROSS": ("골든크로스", "5일선이 20일선을 막 상향 돌파했습니다. 단기 상승 전환 신호로 자주 해석됩니다."),
    "DEAD_CROSS": ("데드크로스", "5일선이 20일선을 막 하향 돌파했습니다. 단기 하락 전환 신호로 자주 해석됩니다."),
    "BREAKOUT_HIGH": ("20일 신고가", "종가가 직전 20일 최고 종가를 넘어섰습니다. 추세 돌파로 보기도, 단기 고점으로 보기도 합니다."),
    "BREAKDOWN_LOW": ("20일 신저가", "종가가 직전 20일 최저 종가 아래로 내려갔습니다. 하락 지속 신호일 수도, 투매 뒤 반등 자리일 수도 있습니다."),
    "VOLUME_SURGE": ("거래량 급증", "거래량이 직전 20일 평균의 2배를 넘었습니다. 큰 손의 매매가 몰린 날입니다."),
    "RSI_OVERBOUGHT": ("RSI 과매수", "RSI(14)가 70 이상입니다. 과열로 되돌림이 나오기 쉬운 구간입니다."),
    "RSI_OVERSOLD": ("RSI 과매도", "RSI(14)가 30 이하입니다. 기술적 반등이 나올 수 있는 구간입니다."),
}


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


def detect_signal(candles: list[dict]) -> str | None:
    """candles 마지막 봉(기준일)에 나타난 신호 코드(SIGNALS 키) 또는 None.

    기준일까지의 봉만 받는다(미래 봉을 넘기지 말 것). 거래량 평균·신고가/신저가는 기준일을 뺀
    직전 SIGNAL_LOOKBACK 봉과 비교한다.
    """
    if len(candles) < SIGNAL_LOOKBACK + 1:
        return None
    closes = [float(c["close"]) for c in candles]
    if max(closes[-15:]) == min(closes[-15:]):  # 거래정지 등 무변동 — RSI 가 100/0 으로 튀는 가짜 신호
        return None
    if indicators.golden_cross_within(closes, within=1):
        return "GOLDEN_CROSS"
    if indicators.golden_cross_within([-c for c in closes], within=1):  # 부호 반전 = 데드크로스
        return "DEAD_CROSS"
    prior = closes[-SIGNAL_LOOKBACK - 1:-1]
    if closes[-1] > max(prior):
        return "BREAKOUT_HIGH"
    if closes[-1] < min(prior):
        return "BREAKDOWN_LOW"
    volumes = [float(c.get("volume") or 0) for c in candles]
    avg_vol = _avg(volumes[-SIGNAL_LOOKBACK - 1:-1])
    if avg_vol > 0 and volumes[-1] >= avg_vol * VOLUME_SURGE_RATIO:
        return "VOLUME_SURGE"
    rsi = rsi_service.wilder_rsi(closes)
    if rsi is not None and rsi >= 70:
        return "RSI_OVERBOUGHT"
    if rsi is not None and rsi <= 30:
        return "RSI_OVERSOLD"
    return None


def avg_turnover(candles: list[dict]) -> float:
    """마지막 SIGNAL_LOOKBACK 봉의 평균 거래대금(종가×거래량). 거래량 결측은 0."""
    recent = candles[-SIGNAL_LOOKBACK:]
    if not recent:
        return 0.0
    return _avg([float(c["close"]) * float(c.get("volume") or 0) for c in recent])


def build_explanation(closes: list[float], signal: str | None = None) -> tuple[str, str]:
    """기준일까지 종가 → (pattern_type, 해설 마크다운). signal 이 있으면 그 신호를 패턴으로 쓴다."""
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
    signal_line = ""
    if signal in SIGNALS and SIGNALS[signal][0] != pattern:
        pattern, signal_desc = SIGNALS[signal]
        signal_line = f"- 신호: {signal_desc}\n"
    md = (
        f"### {pattern}\n"
        f"{signal_line}"
        f"- 5일선 {ma5:,.0f} / 20일선 {ma20:,.0f}: {ma_desc}\n"
        f"- RSI(14) {rsi_text}: {rsi_desc}\n\n"
        "> 패턴은 확률일 뿐 확정이 아닙니다. 손절 원칙과 함께 활용하세요."
    )
    return pattern, md


def evaluate_quiz(
    ticker: str,
    candles: list[dict],
    base_idx: int,
    *,
    min_abs_change: float = MIN_ABS_CHANGE,
    signal: str | None = None,
) -> dict | str:
    """candles[base_idx] 를 기준일로 퀴즈 1개(dict). 조건 미달이면 사유 코드(str):

    INSUFFICIENT_DATA(기준일까지 WINDOW봉·이후 HORIZON봉 부족) | INVALID_SERIES(종가 0 이하·가격제한폭 초과)
    | TOO_FLAT(|등락| < min_abs_change%). 관리자 직접 출제가 사유를 그대로 응답한다.
    """
    if base_idx < WINDOW - 1 or base_idx + HORIZON >= len(candles):
        return "INSUFFICIENT_DATA"
    window = candles[base_idx - WINDOW + 1:base_idx + 1]
    span = candles[base_idx - WINDOW + 1:base_idx + HORIZON + 1]
    if not _valid_series([float(c["close"]) for c in span]):
        return "INVALID_SERIES"
    base_close = float(candles[base_idx]["close"])
    future_close = float(candles[base_idx + HORIZON]["close"])
    change = round((future_close - base_close) / base_close * 100, 2)
    if abs(change) < min_abs_change:
        return "TOO_FLAT"
    pattern, explanation = build_explanation([float(c["close"]) for c in window], signal)
    return {
        "ticker": ticker,
        "base_date": date.fromisoformat(str(candles[base_idx]["date"])[:10]),
        "pattern_type": pattern,
        "chart_snapshot": window,
        "future_snapshot": candles[base_idx + 1:base_idx + HORIZON + 1],  # 제출 후 공개용 정답 구간
        "answer": "UP" if change > 0 else "DOWN",
        "actual_change": Decimal(f"{change:.2f}"),
        "explanation": explanation,
    }


def make_quiz(ticker: str, candles: list[dict], base_idx: int) -> dict | None:
    """candles[base_idx] 를 기준일로 퀴즈 1개. 조건 미달이면 None(사유는 evaluate_quiz)."""
    result = evaluate_quiz(ticker, candles, base_idx)
    return result if isinstance(result, dict) else None


def _fetch_tickers() -> list[str]:
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

    rows = get_client().query(f"SELECT DISTINCT ticker FROM {CLICKHOUSE_DB}.daily_prices FINAL").result_rows
    return [r[0] for r in rows]


def _fetch_candles(ticker: str, start: date | None = None, end: date | None = None) -> list[dict]:
    """일봉(오름차순). 기간 미지정이면 오늘 기준 최근 LOOKBACK_DAYS. CH 장애·미수집이면 []."""
    # 의도적 cross-app import(rsi_service 와 같은 선례), 지연 import
    from apps.stock_api.services import clickhouse_source

    end = end or date.today()
    start = start or end - timedelta(days=LOOKBACK_DAYS)
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


PER_TICKER_MAX = 2  # 한 번 실행에서 같은 종목 최대 문제 수(종목 다양성)


def eligible_quizzes(ticker: str, candles: list[dict]) -> list[tuple[int, dict]]:
    """자동 생성 기준을 통과하는 (base_idx, 퀴즈) 전부 — 거래대금·신호·3% 등락·시계열 유효성."""
    out: list[tuple[int, dict]] = []
    for idx in range(WINDOW - 1, len(candles) - HORIZON):
        base, future = float(candles[idx]["close"]), float(candles[idx + HORIZON]["close"])
        if base <= 0 or abs(future / base - 1) * 100 < AUTO_MIN_ABS_CHANGE:  # 싼 검사 먼저(정확한 판정은 evaluate_quiz)
            continue
        window = candles[idx - WINDOW + 1:idx + 1]  # 기준일까지만 — 신호 판정에 미래 봉을 쓰지 않는다
        if avg_turnover(window) < MIN_TURNOVER:
            continue
        signal = detect_signal(window)
        if signal is None:
            continue
        q = evaluate_quiz(ticker, candles, idx, min_abs_change=AUTO_MIN_ABS_CHANGE, signal=signal)
        if isinstance(q, dict):
            out.append((idx, q))
    return out


def _existing_indices(candles: list[dict], dates: list[date]) -> list[int]:
    """DB 에 이미 있는 기준일 → candles 상 위치(정확히 없으면 그 자리에 들어갈 위치)."""
    keys = [str(c["date"])[:10] for c in candles]
    return [bisect.bisect_left(keys, d.isoformat()) for d in dates]


def collect_quizzes(
    count: int,
    *,
    rng: random.Random,
    fetch_tickers: Callable[[], list[str]],
    fetch_candles: Callable[[str], list[dict]],
    existing: dict[str, list[date]] | None = None,
) -> list[dict]:
    """품질 기준(모듈 docstring)을 통과한 퀴즈 최대 count 개(동기 — CH 조회 포함).

    종목을 섞어 차례로 보며 종목당 PER_TICKER_MAX 개까지, 같은 종목 기준일은 서로·기존 문제와
    MIN_GAP_BARS 이상 떨어지게 고른다. UP/DOWN 은 각각 최대 ceil(count/2) — 한쪽이 모자라면 적게 만든다.
    """
    existing = existing or {}
    tickers = list(fetch_tickers())
    rng.shuffle(tickers)
    side_cap = (count + 1) // 2
    sides = {"UP": 0, "DOWN": 0}
    patterns: collections.Counter[str] = collections.Counter()
    quizzes: list[dict] = []
    empty_tickers = 0
    for t in tickers[:MAX_TICKER_FETCHES]:
        if len(quizzes) >= count:
            break
        candles = fetch_candles(t)
        if not candles:
            empty_tickers += 1
            continue
        candidates = eligible_quizzes(t, candles)
        rng.shuffle(candidates)
        taken = _existing_indices(candles, existing.get(t, []))
        for _ in range(PER_TICKER_MAX):
            if len(quizzes) >= count:
                break
            ok = [
                (idx, q) for idx, q in candidates
                if sides[q["answer"]] < side_cap and all(abs(idx - j) >= MIN_GAP_BARS for j in taken)
            ]
            if not ok:
                break
            # 지금까지 적게 나온 패턴 먼저(신고가·신저가 쏠림 완화) — 같은 횟수면 섞인 순서
            idx, q = min(ok, key=lambda c: patterns[c[1]["pattern_type"]])
            taken.append(idx)
            sides[q["answer"]] += 1
            patterns[q["pattern_type"]] += 1
            quizzes.append(q)
    if empty_tickers:
        print(f"[generate_chart_quiz] 캔들 없음(CH 장애/미수집 가능) 종목 수={empty_tickers}")
    return quizzes


async def load_existing(db) -> dict[str, list[date]]:
    """chart_quiz_pool 의 종목별 기준일(비활성 포함 — 같은 구간 재출제 방지)."""
    rows = (await db.execute(select(ChartQuiz.ticker, ChartQuiz.base_date))).all()
    existing: dict[str, list[date]] = {}
    for ticker, base_date in rows:
        existing.setdefault(ticker, []).append(base_date)
    return existing


async def generate(
    count: int,
    *,
    rng: random.Random,
    fetch_tickers: Callable[[], list[str]] = _fetch_tickers,
    fetch_candles: Callable[[str], list[dict]] = _fetch_candles,
    session_factory=AsyncSessionLocal,
) -> tuple[int, int]:
    async with session_factory() as db:
        existing = await load_existing(db)
    quizzes = collect_quizzes(
        count, rng=rng, fetch_tickers=fetch_tickers, fetch_candles=fetch_candles, existing=existing
    )
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

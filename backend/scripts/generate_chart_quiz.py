"""야간 차트 퀴즈 자동 생성 (Phase 5b, 멱등).

ClickHouse daily_prices 에서 종목을 무작위로 골라, 기준일까지 60봉을 문제로·이후 5봉 종가 변동률로
정답(UP/DOWN)을 정한다. 해설은 기준일 RSI(14)·5/20일 이동평균 상태로 만든 규칙 기반 템플릿.
(ticker, base_date) 가 이미 있으면 건너뛰므로 재실행해도 중복이 생기지 않는다.

자동 생성(collect_quizzes)은 품질 기준을 추가로 적용한다(B1):
- 기준일에 신호(이동평균 교차·20일 신고가/신저가·거래량 급증·RSI 과열/과매도)가 나타난 날만
- |변동률| >= AUTO_MIN_ABS_CHANGE(3%) — 관리자 직접 출제(evaluate_quiz)는 기존 1% 기준 유지
- 같은 종목 문제끼리 공개 구간(차트 + 이후 봉)이 겹치지 않게 — 간격 >= 나중 문제 차트 길이 + 이른 문제 예측 기간
  (최소 MIN_GAP_BARS). DB 의 기존 문제와도 비교
- 기준일까지 20일 평균 거래대금 >= MIN_TURNOVER(10억 원)
- 정답 UP/DOWN 을 반반에 가깝게
- 차트 길이(40/60/120봉)·예측 기간(3/5/10일)을 종목마다 가중 무작위로(B3-1, 직접 출제는 60봉·5일)

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

# 자동 생성 차트 길이·예측 기간(B3-1) — (값, 가중치). 종목마다 한 쌍을 뽑는다.
# 5일 비중을 높게 — 구버전 클라이언트는 5일 문제만 받는다(quiz_service.serve_random)
WINDOW_CHOICES: tuple[tuple[int, int], ...] = ((40, 1), (60, 2), (120, 1))
HORIZON_CHOICES: tuple[tuple[int, int], ...] = ((3, 1), (5, 3), (10, 1))

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


def detect_signals(candles: list[dict]) -> list[str]:
    """candles 마지막 봉(기준일)에 나타난 신호 코드 전부(SIGNALS 우선순위 순서). 없으면 [].

    기준일까지의 봉만 받는다(미래 봉을 넘기지 말 것). 거래량 평균·신고가/신저가는 기준일을 뺀
    직전 SIGNAL_LOOKBACK 봉과 비교한다. 한 봉에 신호가 여럿일 수 있다(예: 신고가 + 거래량 급증) —
    PATTERN 문제의 오답 보기는 여기 없는 신호에서만 고른다.
    """
    if len(candles) < SIGNAL_LOOKBACK + 1:
        return []
    closes = [float(c["close"]) for c in candles]
    if max(closes[-15:]) == min(closes[-15:]):  # 거래정지 등 무변동 — RSI 가 100/0 으로 튀는 가짜 신호
        return []
    found: set[str] = set()
    if indicators.golden_cross_within(closes, within=1):
        found.add("GOLDEN_CROSS")
    if indicators.golden_cross_within([-c for c in closes], within=1):  # 부호 반전 = 데드크로스
        found.add("DEAD_CROSS")
    prior = closes[-SIGNAL_LOOKBACK - 1:-1]
    if closes[-1] > max(prior):
        found.add("BREAKOUT_HIGH")
    if closes[-1] < min(prior):
        found.add("BREAKDOWN_LOW")
    volumes = [float(c.get("volume") or 0) for c in candles]
    avg_vol = _avg(volumes[-SIGNAL_LOOKBACK - 1:-1])
    if avg_vol > 0 and volumes[-1] >= avg_vol * VOLUME_SURGE_RATIO:
        found.add("VOLUME_SURGE")
    rsi = rsi_service.wilder_rsi(closes)
    if rsi is not None and rsi >= 70:
        found.add("RSI_OVERBOUGHT")
    if rsi is not None and rsi <= 30:
        found.add("RSI_OVERSOLD")
    return [code for code in SIGNALS if code in found]


def detect_signal(candles: list[dict]) -> str | None:
    """candles 마지막 봉(기준일)의 대표 신호 코드(우선순위 첫 번째) 또는 None."""
    signals = detect_signals(candles)
    return signals[0] if signals else None


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
    window_bars: int = WINDOW,
    horizon: int = HORIZON,
) -> dict | str:
    """candles[base_idx] 를 기준일로 퀴즈 1개(dict). 조건 미달이면 사유 코드(str):

    INSUFFICIENT_DATA(기준일까지 window_bars봉·이후 horizon봉 부족) | INVALID_SERIES(종가 0 이하·가격제한폭 초과)
    | TOO_FLAT(|등락| < min_abs_change%). 관리자 직접 출제가 사유를 그대로 응답한다(기본 60봉·5일).
    """
    if base_idx < window_bars - 1 or base_idx + horizon >= len(candles):
        return "INSUFFICIENT_DATA"
    window = candles[base_idx - window_bars + 1:base_idx + 1]
    span = candles[base_idx - window_bars + 1:base_idx + horizon + 1]
    if not _valid_series([float(c["close"]) for c in span]):
        return "INVALID_SERIES"
    base_close = float(candles[base_idx]["close"])
    future_close = float(candles[base_idx + horizon]["close"])
    change = round((future_close - base_close) / base_close * 100, 2)
    if abs(change) < min_abs_change:
        return "TOO_FLAT"
    pattern, explanation = build_explanation([float(c["close"]) for c in window], signal)
    return {
        "ticker": ticker,
        "base_date": date.fromisoformat(str(candles[base_idx]["date"])[:10]),
        "pattern_type": pattern,
        "chart_snapshot": window,
        "future_snapshot": candles[base_idx + 1:base_idx + horizon + 1],  # 제출 후 공개용 정답 구간
        "window_bars": window_bars,
        "horizon_bars": horizon,
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
        db.add(ChartQuiz(**{k: v for k, v in q.items() if not k.startswith("_")}))  # _ 키 = 생성 중간값
        created += 1
    await db.commit()
    return created, skipped


PER_TICKER_MAX = 2  # 한 번 실행에서 같은 종목 최대 문제 수(종목 다양성)


def eligible_quizzes(
    ticker: str, candles: list[dict], *, window_bars: int = WINDOW, horizon: int = HORIZON
) -> list[tuple[int, dict]]:
    """자동 생성 기준을 통과하는 (base_idx, 퀴즈) 전부 — 거래대금·신호·3% 등락·시계열 유효성."""
    out: list[tuple[int, dict]] = []
    for idx in range(window_bars - 1, len(candles) - horizon):
        base, future = float(candles[idx]["close"]), float(candles[idx + horizon]["close"])
        if base <= 0 or abs(future / base - 1) * 100 < AUTO_MIN_ABS_CHANGE:  # 싼 검사 먼저(정확한 판정은 evaluate_quiz)
            continue
        window = candles[idx - window_bars + 1:idx + 1]  # 기준일까지만 — 신호 판정에 미래 봉을 쓰지 않는다
        if avg_turnover(window) < MIN_TURNOVER:
            continue
        signals = detect_signals(window)
        if not signals:
            continue
        q = evaluate_quiz(
            ticker, candles, idx, min_abs_change=AUTO_MIN_ABS_CHANGE, signal=signals[0],
            window_bars=window_bars, horizon=horizon,
        )
        if isinstance(q, dict):
            q["_signals"] = signals  # 유형 배정(assign_types)용 — insert 전에 제거된다
            out.append((idx, q))
    return out


def _weighted(rng: random.Random, choices: tuple[tuple[int, int], ...]) -> int:
    values, weights = zip(*choices)
    return rng.choices(values, weights=weights)[0]


# (기준일 위치, 차트 길이, 예측 기간) — 문제가 공개하는 구간은 [idx - window + 1, idx + horizon]
Span = tuple[int, int, int]
Existing = date | tuple[date, int, int]  # 날짜만이면 60봉·5일(B3-1 이전 문제)


def spans_clear(a: Span, b: Span) -> bool:
    """같은 종목 두 문제의 공개 구간이 겹치지 않는가 — 한 문제 차트에 다른 문제의 정답 구간이 보이지 않게.

    나중 문제 차트는 과거로, 이른 문제의 이후 봉은 미래로 뻗으므로
    간격 >= 나중 문제 차트 길이 + 이른 문제 예측 기간(최소 MIN_GAP_BARS).
    """
    early, late = (a, b) if a[0] <= b[0] else (b, a)
    return late[0] - early[0] >= max(MIN_GAP_BARS, late[1] + early[2])


def _existing_spans(candles: list[dict], rows: list[Existing]) -> list[Span]:
    """DB 에 이미 있는 문제 → candles 상 위치(정확히 없으면 그 자리에 들어갈 위치)와 길이."""
    keys = [str(c["date"])[:10] for c in candles]
    out: list[Span] = []
    for r in rows:
        d, w, h = (r, WINDOW, HORIZON) if isinstance(r, date) else r
        out.append((bisect.bisect_left(keys, d.isoformat()), w, h))
    return out


def collect_quizzes(
    count: int,
    *,
    rng: random.Random,
    fetch_tickers: Callable[[], list[str]],
    fetch_candles: Callable[[str], list[dict]],
    existing: dict[str, list[Existing]] | None = None,
    window_choices: tuple[tuple[int, int], ...] = WINDOW_CHOICES,
    horizon_choices: tuple[tuple[int, int], ...] = HORIZON_CHOICES,
) -> list[dict]:
    """품질 기준(모듈 docstring)을 통과한 퀴즈 최대 count 개(동기 — CH 조회 포함).

    종목을 섞어 차례로 보며 종목당 PER_TICKER_MAX 개까지, 같은 종목 문제는 서로·기존 문제와
    공개 구간이 겹치지 않게(spans_clear) 고른다. UP/DOWN 은 각각 최대 ceil(count/2) — 한쪽이 모자라면 적게 만든다.
    차트 길이·예측 기간은 종목마다 가중 무작위로 한 쌍(조합 전부를 훑으면 판정 비용이 몇 배가 된다).
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
        window_bars = _weighted(rng, window_choices)
        horizon = _weighted(rng, horizon_choices)
        candidates = eligible_quizzes(t, candles, window_bars=window_bars, horizon=horizon)
        rng.shuffle(candidates)
        taken = _existing_spans(candles, existing.get(t, []))
        for _ in range(PER_TICKER_MAX):
            if len(quizzes) >= count:
                break
            ok = [
                (idx, q) for idx, q in candidates
                if sides[q["answer"]] < side_cap
                and all(spans_clear((idx, window_bars, horizon), s) for s in taken)
            ]
            if not ok:
                break
            # 지금까지 적게 나온 패턴 먼저(신고가·신저가 쏠림 완화) — 같은 횟수면 섞인 순서
            idx, q = min(ok, key=lambda c: patterns[c[1]["pattern_type"]])
            taken.append((idx, window_bars, horizon))
            sides[q["answer"]] += 1
            patterns[q["pattern_type"]] += 1
            quizzes.append(q)
    if empty_tickers:
        print(f"[generate_chart_quiz] 캔들 없음(CH 장애/미수집 가능) 종목 수={empty_tickers}")
    return quizzes


# ---------------------------------------------------------------- 문제 유형(B3-2)
# 기본 비율 — 나머지는 DIRECTION. 구버전 클라이언트는 DIRECTION 만 받는다(quiz_service.serve_random)
TYPE_MIX: dict[str, float] = {"RANGE": 0.25, "PATTERN": 0.25}
QUIZ_TYPES = ("DIRECTION", "RANGE", "PATTERN")
# 차트(캔들·5/20일선·거래량)에서 보이는 신호만 PATTERN 에 쓴다 — RSI 는 화면에 없어 맞힐 근거가 없다
VISIBLE_SIGNALS = ("GOLDEN_CROSS", "DEAD_CROSS", "BREAKOUT_HIGH", "BREAKDOWN_LOW", "VOLUME_SURGE")
PATTERN_CHOICES = 4
RANGE_EDGE = 5.0
# 등락폭 구간 — 자연 순서로 보여 준다(순서가 정답을 드러내지 않음). ±5.00 은 '이하'/'이상' 쪽
RANGE_CHOICES: tuple[dict, ...] = (
    {"code": "R_BIG_DOWN", "label": "−5% 이하"},
    {"code": "R_DOWN", "label": "−5% ~ 0%"},
    {"code": "R_UP", "label": "0% ~ +5%"},
    {"code": "R_BIG_UP", "label": "+5% 이상"},
)


def range_bucket(change: Decimal | float) -> str:
    """저장된(반올림된) 등락률 → RANGE 정답 코드. 사용자가 보는 '실제 N일 등락' 과 같은 숫자로 판정."""
    c = float(change)
    if c <= -RANGE_EDGE:
        return "R_BIG_DOWN"
    if c < 0:
        return "R_DOWN"
    if c < RANGE_EDGE:
        return "R_UP"
    return "R_BIG_UP"


def _pattern_distractors(q: dict) -> list[str]:
    return [s for s in VISIBLE_SIGNALS if s not in q.get("_signals", [])]


def _to_pattern(q: dict, rng: random.Random) -> None:
    answer = q["_signals"][0]
    codes = [answer, *rng.sample(_pattern_distractors(q), PATTERN_CHOICES - 1)]
    rng.shuffle(codes)
    q.update(quiz_type="PATTERN", answer=answer, choices=[{"code": c, "label": SIGNALS[c][0]} for c in codes])


def _to_range(q: dict) -> None:
    q.update(quiz_type="RANGE", answer=range_bucket(q["actual_change"]), choices=[dict(c) for c in RANGE_CHOICES])


def mix_for(types: list[str] | None) -> dict[str, float]:
    """관리자가 고른 유형 → 비율. None 이면 TYPE_MIX, DIRECTION 만이면 {}, 그 외는 고른 유형끼리 같은 몫."""
    if types is None:
        return dict(TYPE_MIX)
    picked = [t for t in QUIZ_TYPES if t in types]
    share = 1 / len(picked) if picked else 0
    return {t: share for t in picked if t != "DIRECTION"}


def assign_types(quizzes: list[dict], *, rng: random.Random, mix: dict[str, float] | None = None) -> list[dict]:
    """collect_quizzes 결과 일부를 RANGE·PATTERN 으로 바꾼다(제자리 변경, 나머지는 DIRECTION).

    PATTERN — 대표 신호가 VISIBLE_SIGNALS 이고 기준일에 없는 신호로 오답 3개를 채울 수 있는 문제만,
    적게 나온 신호부터. RANGE — 4개 구간이 고르게(구간당 최대 ceil(n/4)). 조건이 안 맞으면 DIRECTION 으로 남는다.
    """
    mix = TYPE_MIX if mix is None else mix
    n = len(quizzes)
    order = list(range(n))
    rng.shuffle(order)
    used: set[int] = set()

    want = round(n * mix.get("PATTERN", 0))
    per_signal: collections.Counter[str] = collections.Counter()
    pattern_ok = [
        i for i in order
        if quizzes[i].get("_signals") and quizzes[i]["_signals"][0] in VISIBLE_SIGNALS
        and len(_pattern_distractors(quizzes[i])) >= PATTERN_CHOICES - 1
    ]
    while want > 0 and pattern_ok:
        i = min(pattern_ok, key=lambda j: per_signal[quizzes[j]["_signals"][0]])
        pattern_ok.remove(i)
        per_signal[quizzes[i]["_signals"][0]] += 1
        _to_pattern(quizzes[i], rng)
        used.add(i)
        want -= 1

    want = round(n * mix.get("RANGE", 0))
    cap = -(-want // len(RANGE_CHOICES))
    per_bucket: collections.Counter[str] = collections.Counter()
    for i in order:
        if want <= 0:
            break
        bucket = range_bucket(quizzes[i]["actual_change"])
        if i in used or per_bucket[bucket] >= cap:
            continue
        per_bucket[bucket] += 1
        _to_range(quizzes[i])
        used.add(i)
        want -= 1

    for i, q in enumerate(quizzes):
        if i not in used:
            q.update(quiz_type="DIRECTION", choices=None)
    return quizzes


async def load_existing(db) -> dict[str, list[Existing]]:
    """chart_quiz_pool 의 종목별 (기준일, 차트 길이, 예측 기간) — 비활성 포함(같은 구간 재출제 방지)."""
    rows = (await db.execute(
        select(ChartQuiz.ticker, ChartQuiz.base_date, ChartQuiz.window_bars, ChartQuiz.horizon_bars)
    )).all()
    existing: dict[str, list[Existing]] = {}
    for ticker, base_date, window_bars, horizon_bars in rows:
        existing.setdefault(ticker, []).append((base_date, window_bars or WINDOW, horizon_bars or HORIZON))
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
    assign_types(quizzes, rng=rng)
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

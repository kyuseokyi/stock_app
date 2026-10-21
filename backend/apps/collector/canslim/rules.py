"""CANSLIM 7항목 판정 — 순수 함수. 기준은 윌리엄 오닐 원전(스펙 docs/superpowers/specs/2026-10-18-canslim-design.md 2절).

입력은 오래된 → 최신 순 목록. 데이터가 모자라면 NA, 아직 켜지 않은 항목(분기 EPS 형식 미확인)은 PENDING.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field

PASS, FAIL, NA, PENDING = 1, 0, -1, -2

WEIGHTS = {"c": 20, "a": 15, "n": 15, "s": 10, "l": 20, "i": 10, "m": 10}

C_MIN_GROWTH = 25.0       # 분기 EPS 전년 동기 대비 %
A_MIN_CAGR = 25.0         # 연간 EPS 3년 연평균 %
A_MIN_ROE = 17.0          # 최근 ROE %
N_MIN_RATIO = 0.85        # 종가 / 52주 최고가
N_MIN_BARS = 60
S_MIN_RATIO = 1.0         # 50봉 상승일 거래량 / 하락일 거래량
S_RATIO_CAP = 99.0
L_MIN_RS = 80             # RS 등급(1~99)
I_MIN_BUY_DAYS = 10       # 최근 20거래일 중 기관+외국인 순매수한 날
I_MIN_DAYS = 15
M_MAX_DIST = 5            # 최근 25거래일 분산일 미만
M_DIST_DROP = -0.002      # 분산일: 지수 -0.2% 이하 + 거래량 증가
LIQ_MIN_VALUE = 1e9       # 20봉 평균 거래대금(원)
LIQ_MIN_PRICE = 1000.0

_RS_LAGS = ((63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2))


@dataclass(frozen=True)
class Verdict:
    status: int
    value: float | None = None
    extra: dict = field(default_factory=dict)


@dataclass(frozen=True)
class MarketState:
    close: float
    ma50: float
    ma200: float
    dist_days: int
    status: str   # 상승 추세 | 조정 | 하락
    passed: bool


# ---------------------------------------------------------------- C·A (재무)
def shift_yymm(yymm: str, months: int) -> str:
    total = int(yymm[:4]) * 12 + int(yymm[4:6]) - 1 + months
    return f"{total // 12:04d}{total % 12 + 1:02d}"


def standalone_quarters(rows, settle_month: int | None, cumulative: bool) -> dict[str, float]:
    """분기 EPS → 단독 분기 EPS. 누적(연초부터 합산)이면 회계연도 첫 분기는 그대로, 나머지는 3개월 전 누적을 뺀다."""
    cum = {ym: eps for ym, eps in rows if eps is not None}
    if not cumulative:
        return cum
    first_q = (settle_month or 12) % 12 + 3
    out = {}
    for ym, eps in cum.items():
        if int(ym[4:6]) == first_q:
            out[ym] = eps
        else:
            prev = shift_yymm(ym, -3)
            if prev in cum:
                out[ym] = eps - cum[prev]
    return out


def eval_c(rows, settle_month: int | None, cumulative: bool | None) -> Verdict:
    if cumulative is None:
        return Verdict(PENDING)
    q = standalone_quarters(rows, settle_month, cumulative)
    if not q:
        return Verdict(NA)
    latest = max(q)
    prev = shift_yymm(latest, -12)
    if prev not in q:
        return Verdict(NA)
    cur, old = q[latest], q[prev]
    extra = {"quarter": latest, "eps": cur, "prev_eps": old}
    if old > 0:
        growth = (cur / old - 1) * 100
        return Verdict(PASS if growth >= C_MIN_GROWTH else FAIL, growth, extra)
    if cur > 0:
        return Verdict(PASS, None, {**extra, "turnaround": True})
    return Verdict(FAIL, None, extra)


def closed_years(rows) -> list:
    """연간(Y) 행 중 결산이 끝난 해만. rows[i][0] = 결산년월, 오름차순.

    KIS 연간 재무비율은 진행 중인 해의 누적 값(예: 12월 결산사의 202606 = 상반기 누적)을 최신 행으로 붙인다.
    결산월 = 최신 행을 뺀 나머지 행에서 가장 많은 월. 행이 하나뿐이면 판단할 수 없어 그대로 둔다."""
    rows = list(rows)
    if len(rows) < 2:
        return rows
    fy_month = Counter(r[0][4:6] for r in rows[:-1]).most_common(1)[0][0]
    return [r for r in rows if r[0][4:6] == fy_month]


def eval_a(rows) -> Verdict:
    """rows: (결산년월, EPS, ROE). 결산이 끝난 최근 4개 연도로 3년 성장(진행 중인 해의 누적 행은 뺀다)."""
    valid = [r for r in closed_years(sorted(rows, key=lambda r: r[0])) if r[1] is not None]
    if len(valid) < 4:
        return Verdict(NA)
    last4 = valid[-4:]
    eps = [r[1] for r in last4]
    roe = last4[-1][2]
    increasing = all(b > a for a, b in zip(eps, eps[1:]))
    extra = {"roe": roe, "years": [r[0] for r in last4]}
    if eps[0] <= 0:
        return Verdict(FAIL, None, extra)
    cagr = ((eps[-1] / eps[0]) ** (1 / 3) - 1) * 100
    ok = increasing and cagr >= A_MIN_CAGR and roe is not None and roe >= A_MIN_ROE
    return Verdict(PASS if ok else FAIL, cagr, extra)


# ---------------------------------------------------------------- N·S·L (가격)
def eval_n(highs, closes) -> Verdict:
    if len(closes) < N_MIN_BARS:
        return Verdict(NA)
    high = max(highs[-252:])
    ratio = closes[-1] / high if high else 0.0
    return Verdict(PASS if ratio >= N_MIN_RATIO else FAIL, (ratio - 1) * 100, {"high_52w": high})


def eval_s(closes, volumes) -> Verdict:
    if len(closes) < 51:
        return Verdict(NA)
    up = down = 0.0
    for i in range(len(closes) - 50, len(closes)):
        if closes[i] > closes[i - 1]:
            up += volumes[i] or 0
        elif closes[i] < closes[i - 1]:
            down += volumes[i] or 0
    if down == 0:
        if up == 0:
            return Verdict(NA)
        ratio = S_RATIO_CAP
    else:
        ratio = min(up / down, S_RATIO_CAP)
    return Verdict(PASS if ratio >= S_MIN_RATIO else FAIL, ratio)


def rs_raw(closes) -> float | None:
    """IBD 식 가중 수익률: 0.4×3개월 + 0.2×6·9·12개월(63·126·189·252봉 전 종가 대비)."""
    if len(closes) < 253:
        return None
    c = closes[-1]
    total = 0.0
    for lag, w in _RS_LAGS:
        base = closes[-1 - lag]
        if not base:
            return None
        total += w * (c / base - 1)
    return total


def rs_percentiles(raws: dict) -> dict:
    """원값 → 백분위 1~99(동률은 같은 값). 원값 없는 종목은 빠진다."""
    items = {k: v for k, v in raws.items() if v is not None}
    if not items:
        return {}
    ordered = sorted(items.values())
    n = len(ordered)
    out = {}
    for k, v in items.items():
        less = bisect_left(ordered, v)
        equal = bisect_right(ordered, v) - less
        out[k] = min(99, max(1, round((less + 0.5 * equal) / n * 100)))
    return out


def eval_l(rs: int | None) -> Verdict:
    if rs is None:
        return Verdict(NA)
    return Verdict(PASS if rs >= L_MIN_RS else FAIL, float(rs))


# ---------------------------------------------------------------- I (수급)
def eval_i(nets) -> Verdict:
    """nets: 최근 거래일별 기관+외국인 순매수 수량."""
    if len(nets) < I_MIN_DAYS:
        return Verdict(NA)
    window = list(nets)[-20:]
    total = sum(window)
    buy_days = sum(1 for x in window if x > 0)
    ok = total > 0 and buy_days >= I_MIN_BUY_DAYS
    return Verdict(PASS if ok else FAIL, float(total), {"buy_days": buy_days, "days": len(window)})


# ---------------------------------------------------------------- M (시장)
def market_state(closes, volumes) -> MarketState | None:
    if len(closes) < 200:
        return None
    close = closes[-1]
    ma50 = sum(closes[-50:]) / 50
    ma200 = sum(closes[-200:]) / 200
    dist = 0
    for i in range(len(closes) - 25, len(closes)):
        if i < 1 or not closes[i - 1]:
            continue
        v, pv = volumes[i], volumes[i - 1]
        if closes[i] / closes[i - 1] - 1 <= M_DIST_DROP and v is not None and pv is not None and v > pv:
            dist += 1
    passed = close > ma50 and ma50 > ma200 and dist < M_MAX_DIST
    status = "상승 추세" if passed else ("하락" if close < ma200 else "조정")
    return MarketState(close, ma50, ma200, dist, status, passed)


def eval_m(state: MarketState | None) -> Verdict:
    if state is None:
        return Verdict(NA)
    return Verdict(PASS if state.passed else FAIL, float(state.dist_days), {"status": state.status})


# ---------------------------------------------------------------- 유동성·점수
def is_liquid(closes, volumes) -> tuple[bool, float | None]:
    if len(closes) < 20:
        return False, None
    avg = sum(c * (v or 0) for c, v in zip(closes[-20:], volumes[-20:])) / 20
    return avg >= LIQ_MIN_VALUE and closes[-1] >= LIQ_MIN_PRICE, avg


def score(verdicts: dict) -> tuple[int, int]:
    passed = [k for k, v in verdicts.items() if v.status == PASS]
    return sum(WEIGHTS[k] for k in passed), len(passed)

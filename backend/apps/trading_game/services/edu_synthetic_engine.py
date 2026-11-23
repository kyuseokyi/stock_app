"""교육용 합성 일봉 생성 엔진 — 순수 함수(DB·Redis 없음).

명세: docs/edu_synthetic_daily_game_spec_and_plan.md 2.1·4.2
- 결정론: 그날 난수 = HMAC-SHA256(seed_key, f"{season_id}:{day_index}"). 시즌마다 DB 에 저장한 무작위 seed_key 를 쓰고
  서버 JWT/SECRET_KEY 는 쓰지 않는다. 같은 시즌·day_index·직전 상태(종가·국면)면 항상 같은 캔들.
- 국면(Regime) 상태 머신 4개가 5~15봉 주기로 전이(ACCUMULATION→UPTREND→DISTRIBUTION→DOWNTREND→…),
  관리자 next_regime_override 가 있으면 다음 봉부터 그 국면.
- 가격은 한국 거래소 호가 단위로 반올림, 최소 1틱. OHLC 불변식 low ≤ open,close ≤ high.
- 실제 종목·시세와 무관한 자체 생성 데이터다.
"""
from __future__ import annotations

import hashlib
import hmac
import random
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

REGIMES = ("ACCUMULATION", "UPTREND", "DISTRIBUTION", "DOWNTREND")
NEXT_REGIME = {
    "ACCUMULATION": "UPTREND",
    "UPTREND": "DISTRIBUTION",
    "DISTRIBUTION": "DOWNTREND",
    "DOWNTREND": "ACCUMULATION",
}
REGIME_MIN_DAYS = 5
REGIME_MAX_DAYS = 15
INITIAL_REGIME = "ACCUMULATION"
INITIAL_REGIME_DAYS = 8

WARMUP_BARS = 120
START_PRICE = 50_000
BASE_VOLUME = 1_000_000
DAILY_LIMIT = 0.29          # 한국 상·하한가(±30%) 안쪽으로 등락 제한
POC_LOOKBACK = 60
POC_BINS = 24
SR_LOOKBACK = 60
SR_FALLBACK = 20
SWING = 2                   # 스윙 고저점 판정 좌우 봉 수


@dataclass(frozen=True)
class RegimeParams:
    mean: float             # 평균 일간 등락(비율)
    std: float              # 표준편차(비율)
    vol_range: tuple[float, float]  # 거래량 배수 범위
    upper_wick: float       # 윗꼬리 배수
    lower_wick: float       # 아래꼬리 배수


REGIME_PARAMS: dict[str, RegimeParams] = {
    "ACCUMULATION": RegimeParams(0.0, 0.011, (0.6, 0.9), 1.0, 1.0),
    "UPTREND": RegimeParams(0.0085, 0.018, (1.1, 2.2), 0.8, 1.0),
    "DISTRIBUTION": RegimeParams(0.001, 0.024, (1.5, 2.8), 1.8, 0.8),
    "DOWNTREND": RegimeParams(-0.0075, 0.019, (0.9, 1.6), 1.0, 1.2),
}


# ---------------------------------------------------------------- 호가 단위
def tick_size(price: float) -> int:
    """한국 거래소 호가 단위(2023 개편 기준)."""
    if price < 2_000:
        return 1
    if price < 5_000:
        return 5
    if price < 20_000:
        return 10
    if price < 50_000:
        return 50
    if price < 200_000:
        return 100
    if price < 500_000:
        return 500
    return 1_000


def round_tick(price: float) -> int:
    """호가 단위 반올림(최소 1틱). 단위가 서로 배수 관계라 결과는 항상 자기 단위 격자 위에 있다."""
    if price <= 0:
        return 1
    t = tick_size(price)
    v = int((Decimal(str(price)) / t).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) * t
    return max(v, tick_size(v) if v > 0 else 1, 1)


# ---------------------------------------------------------------- 날짜
def _is_weekday(d: date) -> bool:
    return d.weekday() < 5


def next_weekday(d: date) -> date:
    n = d + timedelta(days=1)
    while not _is_weekday(n):
        n += timedelta(days=1)
    return n


def weekdays_before(start: date, count: int) -> list[date]:
    """start 이전(미포함) 평일 count 개, 오래된 순."""
    out: list[date] = []
    d = start - timedelta(days=1)
    while len(out) < count:
        if _is_weekday(d):
            out.append(d)
        d -= timedelta(days=1)
    return list(reversed(out))


# ---------------------------------------------------------------- 난수·국면
def day_rng(seed_key: str, season_id: int, day_index: int) -> random.Random:
    digest = hmac.new(seed_key.encode(), f"{season_id}:{day_index}".encode(), hashlib.sha256).digest()
    return random.Random(int.from_bytes(digest, "big"))


def next_regime_state(
    rng: random.Random, regime: str, days_left: int, override: str | None
) -> tuple[str, int]:
    """이번 봉에 적용할 (국면, 남은 봉 수). 관리자 지정이 있으면 즉시 그 국면으로 새 주기를 시작."""
    if override in REGIMES:
        return override, rng.randint(REGIME_MIN_DAYS, REGIME_MAX_DAYS)
    if regime not in REGIMES:
        regime = INITIAL_REGIME
    if days_left <= 0:
        return NEXT_REGIME[regime], rng.randint(REGIME_MIN_DAYS, REGIME_MAX_DAYS)
    return regime, days_left


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def make_ohlcv(rng: random.Random, prev_close: int, regime: str) -> dict:
    """직전 종가와 국면으로 OHLCV 1개. 반올림 뒤 불변식을 다시 맞춘다."""
    p = REGIME_PARAMS[regime]
    ret = _clamp(rng.gauss(p.mean, p.std), -DAILY_LIMIT, DAILY_LIMIT)
    gap = _clamp(rng.gauss(0.0, p.std * 0.35), -DAILY_LIMIT / 2, DAILY_LIMIT / 2)
    upper = abs(rng.gauss(0.0, p.std * 0.5)) * p.upper_wick
    lower = abs(rng.gauss(0.0, p.std * 0.5)) * p.lower_wick
    vol_mult = rng.uniform(*p.vol_range)

    o = round_tick(prev_close * (1 + gap))
    c = round_tick(prev_close * (1 + ret))
    h = max(round_tick(max(o, c) + upper * prev_close), o, c)
    low_raw = min(o, c) - lower * prev_close
    lo = min(round_tick(low_raw) if low_raw > 0 else 1, o, c)
    lo = max(lo, 1)
    volume = int(BASE_VOLUME * vol_mult * (1 + 8 * abs(ret)))
    return {"open": o, "high": h, "low": lo, "close": c, "volume": max(volume, 1)}


# ---------------------------------------------------------------- 지표
def _sma(values: list[int], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def compute_poc(candles: list[dict], lookback: int = POC_LOOKBACK, bins: int = POC_BINS) -> int | None:
    """최근 lookback 봉 가격대별 거래량(bins 구간) — 최대 구간 중심가(틱 반올림)."""
    window = candles[-lookback:]
    if not window:
        return None
    lo = min(c["low"] for c in window)
    hi = max(c["high"] for c in window)
    if hi <= lo:
        return round_tick(window[-1]["close"])
    width = (hi - lo) / bins
    hist = [0.0] * bins
    for c in window:
        a = min(int((c["low"] - lo) / width), bins - 1)
        b = min(int((c["high"] - lo) / width), bins - 1)
        share = c["volume"] / (b - a + 1)
        for i in range(a, b + 1):
            hist[i] += share
    best = max(range(bins), key=lambda i: (hist[i], -i))
    return round_tick(lo + width * (best + 0.5))


def compute_support_resistance(
    candles: list[dict], lookback: int = SR_LOOKBACK, swing: int = SWING
) -> tuple[int | None, int | None]:
    """최근 lookback 봉의 스윙 저점·고점 중 현재 종가에 가장 가까운 아래/위 가격.

    스윙 레벨이 없으면 최근 SR_FALLBACK 봉 최저가/최고가로 대신한다.
    """
    window = candles[-lookback:]
    if not window:
        return None, None
    close = window[-1]["close"]
    lows, highs = [], []
    for i in range(swing, len(window) - swing):
        seg = window[i - swing:i + swing + 1]
        if window[i]["low"] == min(c["low"] for c in seg):
            lows.append(window[i]["low"])
        if window[i]["high"] == max(c["high"] for c in seg):
            highs.append(window[i]["high"])
    below = [v for v in lows if v < close]
    above = [v for v in highs if v > close]
    recent = window[-SR_FALLBACK:]
    support = max(below) if below else min(c["low"] for c in recent)
    resistance = min(above) if above else max(c["high"] for c in recent)
    return round_tick(support), round_tick(resistance)


def _fmt(v: int | None) -> str:
    return f"{v:,}원" if v is not None else "-"


def build_edu_comment(candles: list[dict], prev: dict | None) -> tuple[str, str]:
    """(pattern_tag, 교육 해설 1~2문장). candles 마지막 봉이 오늘, prev 는 직전 봉(지표 포함)."""
    today = candles[-1]
    o, h, lo, c, v = today["open"], today["high"], today["low"], today["close"], today["volume"]
    closes = [x["close"] for x in candles]
    ma5, ma20, ma60 = _sma(closes, 5), _sma(closes, 20), _sma(closes, 60)
    prev_ma20 = _sma(closes[:-1], 20)
    vols = [x["volume"] for x in candles[:-1]]
    avg_vol = _sma(vols, 20)
    poc, sup, res = today.get("poc_price"), today.get("support_price"), today.get("resistance_price")
    prev_close = prev["close"] if prev else o

    body = abs(c - o)
    upper_wick = h - max(o, c)
    lower_wick = min(o, c) - lo
    bullish, bearish = c > o, c < o
    heavy = avg_vol is not None and v >= 2 * avg_vol

    tag = "박스권 횡보"
    advice = "방향이 정해질 때까지 지지·저항 사이 박스권을 지켜보세요."
    p_res = prev.get("resistance_price") if prev else None
    p_sup = prev.get("support_price") if prev else None
    if p_res and bullish and prev_close <= p_res and c > p_res * 1.005:  # 0.5% 이상 확실한 돌파만
        tag, advice = "저항선 돌파", f"직전 저항선({_fmt(p_res)})이 이제 지지선 역할을 하는지 확인하세요."
    elif p_sup and bearish and prev_close >= p_sup and c < p_sup * 0.995:
        tag, advice = "지지선 이탈", f"지지선({_fmt(p_sup)}) 이탈 — 손절 원칙을 지키는 연습을 해 보세요."
    elif ma20 and prev_ma20 and prev_close < prev_ma20 and c > ma20:
        tag, advice = "20일선 돌파", "20일선 위에서 종가가 유지되는지 다음 봉을 확인하세요."
    elif ma20 and prev_ma20 and prev_close > prev_ma20 and c < ma20:
        tag, advice = "20일선 이탈", "20일선 아래로 내려왔습니다. 추세 약화 신호인지 확인하세요."
    elif poc and prev_close <= poc < c:
        tag, advice = "POC 매물대 돌파", f"매물대 중심({_fmt(poc)}) 위 안착 여부가 관건입니다."
    elif poc and prev_close >= poc > c:
        tag, advice = "POC 매물대 이탈", f"매물대 중심({_fmt(poc)})이 이제 저항이 될 수 있습니다."
    elif bearish and upper_wick >= 2 * max(body, 1):
        tag, advice = "윗꼬리 음봉", "위쪽 매도 물량이 많았다는 뜻 — 저항선 근처라면 추격 매수를 조심하세요."
    elif bullish and lower_wick >= 2 * max(body, 1):
        tag, advice = "아래꼬리 양봉", "아래에서 받쳐 주는 매수세가 있었습니다. 지지선 확인 신호인지 살펴보세요."
    elif heavy and bullish:
        tag, advice = "거래량 급증 양봉", "거래량이 실린 상승은 신뢰도가 높습니다. 다음 봉 지지 여부를 확인하세요."
    elif heavy and bearish:
        tag, advice = "거래량 급증 음봉", "거래량이 실린 하락입니다. 무리한 물타기보다 손절 기준을 먼저 세우세요."
    elif ma5 and ma20 and ma60 and ma5 > ma20 > ma60:
        tag, advice = "정배열 유지", f"단기 지지선({_fmt(sup)}) 유지 여부를 확인하세요."
    elif ma5 and ma20 and ma60 and ma5 < ma20 < ma60:
        tag, advice = "역배열 지속", f"저항선({_fmt(res)}) 돌파 전까지는 반등을 조심스럽게 보세요."

    shape = "양봉" if bullish else ("음봉" if bearish else "도지(십자형)")
    vol_txt = "거래량이 실린 " if heavy else ""
    refs = []
    if ma20:
        refs.append(("20일 이동평균선", c >= ma20))
    if poc:
        refs.append((f"POC 매물대({_fmt(poc)})", c >= poc))
    if refs and all(above for _, above in refs):
        where = " 위에서 "
        names = "과 ".join(n for n, _ in refs)
        first = f"{names}{where}{vol_txt}{shape}이 출현했습니다."
    elif refs and not any(above for _, above in refs):
        names = "과 ".join(n for n, _ in refs)
        first = f"{names} 아래에서 {vol_txt}{shape}이 출현했습니다."
    else:
        first = f"주요 기준선 사이에서 {vol_txt}{shape}이 출현했습니다."
    return tag, f"{first} {advice}"


def enrich(candles: list[dict]) -> dict:
    """candles 마지막 봉에 poc·지지·저항·패턴 태그·코치 해설을 채워 반환(제자리 수정)."""
    today = candles[-1]
    today["poc_price"] = compute_poc(candles)
    today["support_price"], today["resistance_price"] = compute_support_resistance(candles)
    prev = candles[-2] if len(candles) >= 2 else None
    today["pattern_tag"], today["coach_comment"] = build_edu_comment(candles, prev)
    return today


def _change_pct(prev_close: int, close: int) -> Decimal:
    return (Decimal(close) / Decimal(prev_close) * 100 - 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------- 생성기
def generate_initial_candles(
    seed_key: str, season_id: int, start_date: date, *,
    start_price: int = START_PRICE, count: int = WARMUP_BARS,
) -> tuple[list[dict], str, int]:
    """워밍업 count 봉(day_index 1..count, start_date 이전 평일) → (candles, 마지막 국면, 남은 봉 수)."""
    dates = weekdays_before(start_date, count)
    regime, days_left = INITIAL_REGIME, INITIAL_REGIME_DAYS
    prev_close = round_tick(start_price)
    candles: list[dict] = []
    for i in range(count):
        day = i + 1
        rng = day_rng(seed_key, season_id, day)
        regime, days_left = next_regime_state(rng, regime, days_left, None)
        bar = make_ohlcv(rng, prev_close, regime)
        days_left -= 1
        bar.update(day_index=day, display_date=dates[i], regime=regime,
                   change_pct=_change_pct(prev_close, bar["close"]))
        candles.append(bar)
        enrich(candles)
        prev_close = bar["close"]
    return candles, regime, days_left


def generate_next_candle(
    seed_key: str, season_id: int, history: list[dict], regime: str, days_left: int,
    override: str | None = None,
) -> tuple[dict, str, int]:
    """다음 1봉 → (candle, 국면, 남은 봉 수). history 는 최근 봉들(지표 계산에 60봉 이상 권장, 오래된 순)."""
    last = history[-1]
    day = last["day_index"] + 1
    rng = day_rng(seed_key, season_id, day)
    regime, days_left = next_regime_state(rng, regime, days_left, override)
    bar = make_ohlcv(rng, last["close"], regime)
    days_left -= 1
    bar.update(day_index=day, display_date=next_weekday(last["display_date"]), regime=regime,
               change_pct=_change_pct(last["close"], bar["close"]))
    enrich([*history, bar])
    return bar, regime, days_left

"""데일리 코치 지지·저항 추천 — 순수 계산(I/O 없음).

방식: 최근 60거래일의 확정 스윙 고점·저점을 ±1.5% 가격대로 묶고, 고가·저가가 그 가격대에
닿은 봉 수(터치)에 거리 가중을 곱한 점수가 가장 높은 것을 기준가(마지막 종가) 아래=지지, 위=저항으로 고른다.
후보가 없으면 확정된 20거래일 최저가/최고가로 폴백하고, 그마저 없으면 None(지어내지 않음).
결과는 KRX 호가단위로 반올림하며 항상 0 < 지지 < 기준가 < 저항, 기준가 ±15% 이내.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

LOOKBACK = 60          # 거래일
FALLBACK_LOOKBACK = 20
PIVOT_SPAN = 2         # 스윙 판정: 앞뒤 2봉보다 높/낮음. 마지막 2봉은 미확정
BAND_PCT = 0.015       # 같은 가격대로 보는 폭
MAX_DIST_PCT = 0.15    # 기준가에서 이보다 먼 가격대는 차트 밖이라 제외
MIN_BARS = 10


@dataclass(frozen=True)
class Bar:
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class Level:
    price: int
    touches: int
    basis: str


def krx_tick(price: float) -> int:
    """KRX 호가단위(2023-01 KOSPI·KOSDAQ 통합)."""
    for limit, tick in ((2_000, 1), (5_000, 5), (20_000, 10), (50_000, 50), (200_000, 100), (500_000, 500)):
        if price < limit:
            return tick
    return 1_000


def round_to_tick(price: float) -> int:
    tick = krx_tick(price)
    return int(math.floor(price / tick + 0.5)) * tick


@dataclass
class _Zone:
    prices: list[float]
    kinds: set[str]  # "H" 고점 / "L" 저점

    @property
    def level(self) -> float:
        return sum(self.prices) / len(self.prices)


def _pivots(bars: Sequence[Bar]) -> list[tuple[float, str]]:
    out: list[tuple[float, str]] = []
    for i in range(PIVOT_SPAN, len(bars) - PIVOT_SPAN):
        around = [*bars[i - PIVOT_SPAN:i], *bars[i + 1:i + 1 + PIVOT_SPAN]]
        if all(bars[i].high > b.high for b in around):
            out.append((bars[i].high, "H"))
        if all(bars[i].low < b.low for b in around):
            out.append((bars[i].low, "L"))
    return out


def _zones(pivots: list[tuple[float, str]]) -> list[_Zone]:
    zones: list[_Zone] = []
    for price, kind in sorted(pivots):
        if zones and price <= zones[-1].prices[0] * (1 + BAND_PCT):
            zones[-1].prices.append(price)
            zones[-1].kinds.add(kind)
        else:
            zones.append(_Zone([price], {kind}))
    return zones


def _touches(bars: Sequence[Bar], level: float) -> int:
    lo, hi = level * (1 - BAND_PCT), level * (1 + BAND_PCT)
    return sum(1 for b in bars if lo <= b.low <= hi or lo <= b.high <= hi)


def _label(kinds: set[str], below: bool) -> str:
    """역할 전환(깨진 지지가 저항, 돌파한 저항이 지지)은 관리자가 헷갈리지 않게 따로 표시."""
    if kinds == {"L"}:
        return "저점권" if below else "이전 저점권(깨진 지지)"
    if kinds == {"H"}:
        return "이전 고점권(돌파한 저항)" if below else "고점권"
    return "매물대"


def _snap(level: float, ref: float, below: bool) -> int:
    """호가 반올림 후에도 지지 < 기준가 < 저항이 되도록 한 호가씩 밀어낸다."""
    p = round_to_tick(level)
    if below:
        while p >= ref and p > 1:
            p -= krx_tick(p - 1)
    else:
        while p <= ref:
            p += krx_tick(p)
    return p


def _pick(bars: Sequence[Bar], zones: list[_Zone], ref: float, below: bool) -> Level | None:
    def in_range(x: float) -> bool:
        if below:
            return ref * (1 - MAX_DIST_PCT) <= x < ref
        return ref < x <= ref * (1 + MAX_DIST_PCT)

    scored = [(_touches(bars, z.level), z) for z in zones if in_range(z.level)]
    if scored:
        # 터치 수 × 거리 가중(기준가에서 15% 멀어지면 0) — 멀리 있는 오래된 매물대보다 가까운 가격대 우선.
        # 같으면 기준가에 가까운 순
        def score(t: tuple[int, _Zone]) -> tuple[float, float]:
            dist = abs(t[1].level - ref) / ref
            return t[0] * (1 - dist / MAX_DIST_PCT), -dist

        touches, zone = max(scored, key=score)
        return Level(
            price=_snap(zone.level, ref, below), touches=touches,
            basis=f"최근 {len(bars)}거래일 {_label(zone.kinds, below)} · {touches}회 터치",
        )

    # 폴백: 확정된(마지막 PIVOT_SPAN 봉이 아닌) 20거래일 최저가/최고가
    recent = list(bars[-FALLBACK_LOOKBACK:])
    values = [b.low for b in recent] if below else [b.high for b in recent]
    extreme = min(values) if below else max(values)
    if values.index(extreme) >= len(recent) - PIVOT_SPAN or not in_range(extreme):
        return None
    return Level(
        price=_snap(extreme, ref, below), touches=_touches(bars, extreme),
        basis=f"최근 {len(recent)}거래일 {'최저가' if below else '최고가'}",
    )


def suggest_levels(bars: Sequence[Bar]) -> tuple[Level | None, Level | None]:
    """(지지, 저항). bars 는 오래된→최근 순 일봉. 데이터 부족이면 (None, None)."""
    window = list(bars[-LOOKBACK:])
    if len(window) < MIN_BARS:
        return None, None
    ref = window[-1].close
    zones = _zones(_pivots(window))
    return _pick(window, zones, ref, below=True), _pick(window, zones, ref, below=False)

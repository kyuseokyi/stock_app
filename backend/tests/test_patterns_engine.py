"""차트 패턴 엔진 — 후보 선택 규칙(겹침 제거·같은 베이스 병합·flat 흡수·형성 중 하나만),
detect() 출력 필드·표시 구간 필터·입력 이상 방어. 합성 데이터만(DB 없음)."""
import datetime as dt
import time

import numpy as np

from apps.collector.patterns import Base, detect
from apps.collector.patterns.detector import _select
from apps.collector.patterns.kinds import PatternMatch

D0 = dt.date(2025, 1, 1)


def _pm(kind, h, end, bo=None, conf=0.8, pivot=100.0, depth=20.0):
    return PatternMatch(pattern_type=kind, h_idx=h, trough_idx=(h + end) // 2, end_idx=end, pivot_price=pivot,
                        broke_out=bo is not None, breakout_idx=bo, depth=depth, confidence=conf)


def _bars(closes, vols=None, pct=False):
    out = []
    for i, c in enumerate(closes):
        h, lo = (c * 1.01, c * 0.99) if pct else (c + 1.0, c - 1.0)
        out.append((D0 + dt.timedelta(days=i), c, h, lo, c, (vols[i] if vols else 1000.0)))
    return out


# ---------------------------------------------------------------- 선택 규칙
def test_overlap_keeps_better_ranked():
    highs = np.full(200, 100.0)
    # 쌍바닥(구체적 모양) 이 겹치는 박스권(일반)을 이긴다
    cons = _pm("consolidation", 10, 120, bo=121, conf=0.6)
    db = _pm("double_bottom", 50, 100, bo=101, conf=0.7)
    later = _pm("cup", 130, 170, bo=171, conf=0.9)
    chosen = _select([cons, db, later], highs, 200)
    assert [m.pattern_type for m in chosen] == ["double_bottom", "cup"]


def test_same_base_collapses_to_widest_rim():
    # 같은 모양·같은 돌파(80), 두 림 사이 회복 없음(앞 림의 93% 미만) → 이른 림 하나
    highs = np.full(200, 80.0)
    highs[0] = 100.0
    wide = _pm("cup", 0, 79, bo=80, conf=0.5)
    tight = _pm("cup", 30, 79, bo=80, conf=0.9)
    chosen = _select([wide, tight], highs, 200)
    assert len(chosen) == 1 and chosen[0].h_idx == 0


def test_recovery_between_rims_keeps_distinct_bases():
    # 사이에 앞 림의 93% 이상 회복 → 서로 다른 베이스로 남고, 겹침 제거에서 신뢰도 높은 쪽이 이긴다
    highs = np.full(200, 80.0)
    highs[0] = 100.0
    highs[20] = 95.0
    wide = _pm("cup", 0, 79, bo=80, conf=0.5)
    tight = _pm("cup", 30, 79, bo=80, conf=0.9)
    chosen = _select([wide, tight], highs, 200)
    assert len(chosen) == 1 and chosen[0].h_idx == 30


def test_flat_base_absorbed_by_enclosing_consolidation():
    # 같은 봉(90)에서 돌파, 박스권 림(10) ≤ 플랫 림(50) → 플랫은 박스권에 흡수
    highs = np.full(200, 100.0)
    flat = _pm("flat_base", 50, 89, bo=90, conf=0.6, depth=10.0)
    cons = _pm("consolidation", 10, 89, bo=90, conf=0.6, depth=30.0)
    chosen = _select([flat, cons], highs, 200)
    assert [m.pattern_type for m in chosen] == ["consolidation"]
    # 돌파가 다르면 흡수 안 함 → 순위상 플랫이 이김
    cons2 = _pm("consolidation", 10, 88, bo=95, conf=0.6, depth=30.0)
    assert [m.pattern_type for m in _select([flat, cons2], highs, 200)] == ["flat_base"]


def test_only_last_base_may_be_forming():
    highs = np.full(300, 100.0)
    stale = _pm("cup", 0, 60, bo=None)  # 형성 중인데 뒤에 다른 베이스가 있음 → 실패한 베이스
    mid = _pm("cup", 80, 140, bo=141)
    last = _pm("flat_base", 160, 299, bo=None)
    chosen = _select([stale, mid, last], highs, 300)
    assert [(m.h_idx, m.broke_out) for m in chosen] == [(80, True), (160, False)]


# ---------------------------------------------------------------- detect()
def _cup_series():
    x = np.linspace(-1, 1, 50)
    closes = [90.0] * 5 + (20.0 * x ** 2 + 80.0).tolist() + [105.0] * 5
    vols = [1000.0] * len(closes)
    vols[55] = 3000.0
    return closes, vols


def test_detect_cup_fields():
    closes, vols = _cup_series()
    res = detect(_bars(closes, vols))
    assert len(res) == 1
    b = res[0]
    assert isinstance(b, Base) and b.pattern_type == "cup"
    assert b.rim_date == D0 + dt.timedelta(days=5)
    assert b.pivot == 101.0 and b.is_active is False
    assert b.breakout_date == D0 + dt.timedelta(days=55)  # 고가 > 피벗 첫 봉
    assert b.length == 50  # 림(5)..돌파 전날(54), 돌파봉 제외
    assert b.days_since_breakout == 5  # 돌파봉(55)..마지막(59) 포함
    assert b.low_price == round(b.pivot * (1 - b.depth / 100), 4)
    assert b.low_date == D0 + dt.timedelta(days=int(np.argmin(np.array(closes[5:55]))) + 5)
    assert b.breakout_price_pct == 5.0  # 100 → 105
    assert b.breakout_vol_pct == round((3000 / 1040 - 1) * 100, 2)  # 50봉 평균 대비
    assert (b.base_count, b.subcount, b.totalcount, b.label) == (1, 0, 1, "1")
    assert b.points[0] == {"role": "rim", "date": "2025-01-06", "price": 101.0}
    assert type(b.breakout_price_pct) is float and type(b.breakout_vol_pct) is float


def test_detect_htf_reports_htf_name_and_second_high_pivot():
    from test_patterns_kinds import _htf_prices

    p = _htf_prices()
    res = detect(_bars(p, pct=True))
    assert [b.pattern_type for b in res] == ["htf"]
    b = res[0]
    assert b.pivot == round(p[67] * 1.01, 4) and b.pivot < p[58] * 1.01
    assert b.breakout_date == D0 + dt.timedelta(days=80) and b.length == 22


def test_detect_forming_base_is_active():
    closes, _ = _cup_series()
    res = detect(_bars(closes[:54]))  # 돌파 전에서 자름
    assert res and res[-1].is_active is True
    assert res[-1].breakout_date is None and res[-1].days_since_breakout is None
    assert res[-1].breakout_price_pct is None


def test_display_window_filter():
    closes, vols = _cup_series()
    bars = _bars(closes, vols)  # n=60, 돌파 idx 55
    assert len(detect(bars, display_bars=5)) == 1  # serve_from=55 ≤ 돌파
    assert detect(bars, display_bars=4) == []  # serve_from=56 > 돌파 → 화면 밖


def test_detect_bad_input_never_raises():
    assert detect([]) == []
    assert detect(None) == []
    assert detect(_bars([100.0] * 10)) == []  # 너무 짧음
    zeros = [(D0 + dt.timedelta(days=i), 0, 0, 0, 0, 0) for i in range(30)]
    assert detect(zeros) == []
    closes, _ = _cup_series()
    bars = _bars(closes)
    bars[20] = (bars[20][0], None, None, None, None, None)  # 빈 봉 → 제외
    bars[30] = (bars[30][0], 0, 0, 0, 0, 0)  # 0 가격 → 제외
    bars[40] = bars[40][:5] + (None,)  # 거래량 없음
    bars[41] = bars[41][:2] + (float("nan"),) + bars[41][3:]
    res = detect(bars)
    assert all(isinstance(b, Base) for b in res)


def test_detect_random_walk_is_fast_and_consistent():
    rng = np.random.default_rng(7)
    c = 100 * np.exp(np.cumsum(rng.normal(0.0008, 0.02, 770)))
    bars = [(D0 + dt.timedelta(days=i), c[i], c[i] * 1.01, c[i] * 0.99, c[i], 1e6) for i in range(770)]
    t = time.perf_counter()
    res = detect(bars)
    assert time.perf_counter() - t < 2.0
    assert res and res == detect(bars)  # 결정적
    rims = [b.rim_date for b in res]
    assert rims == sorted(rims)  # 오래된 → 최신
    assert all(not b.is_active for b in res[:-1])  # 형성 중은 마지막 하나만

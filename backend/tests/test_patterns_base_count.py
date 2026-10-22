"""베이스 단계(base_count) — 첫 베이스 1, 피벗 상승 <20% 는 베이스 위 베이스(1a), ≥20% 는 단계 증가,
저점 하락·경로 −10% 붕괴는 1 로 리셋."""
import numpy as np

from apps.collector.patterns.base_count import calculate_stage_step, walk_bases
from apps.collector.patterns.kinds import PatternMatch


def _m(h, trough, pivot, depth, bo=None):
    return PatternMatch(pattern_type="cup", h_idx=h, trough_idx=trough, end_idx=(bo - 1) if bo else trough + 5,
                        pivot_price=pivot, broke_out=bo is not None, breakout_idx=bo, depth=depth,
                        confidence=0.8)


def _labels(stages):
    return [(s["base_count"], s["subcount"], s["totalcount"], s["base_label"]) for s in stages]


def test_first_base_is_stage_1():
    st = walk_bases([_m(0, 10, 100.0, 20.0, bo=30)])
    assert _labels(st) == [(1, 0, 1, "1")]
    assert st[0]["prior_uptrend_pct"] is None
    assert st[0]["trough_price"] == 80.0  # pivot × (1 − depth/100)


def test_small_advance_is_base_on_base():
    # 피벗 100 → 110(+10% < 20%), 저점 80 → 99 (안 깨짐) → 1a
    st = walk_bases([_m(0, 10, 100.0, 20.0, bo=30), _m(40, 50, 110.0, 10.0, bo=70)])
    assert _labels(st) == [(1, 0, 1, "1"), (1, 1, 2, "1a")]
    assert st[1]["prior_uptrend_pct"] == 10.0


def test_large_advance_increments_stage():
    # 100 → 130(+30%) → 단계 2, 그 다음 +10% → 2a
    seq = [_m(0, 10, 100.0, 20.0, bo=30), _m(40, 50, 130.0, 10.0, bo=70), _m(80, 90, 143.0, 8.0, bo=110)]
    assert _labels(walk_bases(seq)) == [(1, 0, 1, "1"), (2, 0, 2, "2"), (2, 1, 3, "2a")]


def test_exact_20pct_counts_as_stage_advance():
    si = calculate_stage_step(_m(40, 50, 120.0, 10.0), 100.0, 80.0, 1, 0, 1)
    assert (si["base_count"], si["base_label"]) == (2, "2")


def test_lower_trough_resets():
    # 두 번째 베이스 저점 = 130 × 0.5 = 65 < 직전 저점 80 → 리셋
    st = walk_bases([_m(0, 10, 100.0, 20.0, bo=30), _m(40, 50, 130.0, 50.0, bo=70)])
    assert _labels(st)[1] == (1, 0, 1, "1")


def test_path_crash_resets():
    # 직전 저점 80. 돌파(30) 뒤 ~ 다음 베이스 저점 사이 경로가 70(−12.5%)까지 → 리셋
    lows = np.full(120, 100.0)
    lows[45] = 70.0
    seq = [_m(0, 10, 100.0, 20.0, bo=30), _m(40, 50, 130.0, 10.0, bo=70)]
    assert _labels(walk_bases(seq, lows=lows))[1] == (1, 0, 1, "1")
    # 경로 저점이 −10% 이내(75 > 72)면 리셋 아님 → 단계 2
    lows[45] = 75.0
    assert _labels(walk_bases(seq, lows=lows))[1] == (2, 0, 2, "2")


def test_sub_letter_progression():
    seq = [_m(i * 40, i * 40 + 10, 100.0 * (1.05 ** i), 5.0, bo=i * 40 + 30) for i in range(4)]
    assert [s["base_label"] for s in walk_bases(seq)] == ["1", "1a", "1b", "1c"]

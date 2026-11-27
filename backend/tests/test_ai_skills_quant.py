"""AI Lab 정량 팩트 순수 함수 — 손으로 만든 봉·목록으로 경계와 수치를 검산한다(DB 없음)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from apps.ai_analyst.skills import quant_facts as Q


def _bars(closes, highs=None, lows=None, vols=None):
    d0 = date(2025, 1, 1)
    out = []
    for i, c in enumerate(closes):
        out.append({"date": d0 + timedelta(days=i), "open": c,
                    "high": highs[i] if highs else c, "low": lows[i] if lows else c,
                    "close": c, "volume": vols[i] if vols else 1000})
    return out


def _cond(res, no):
    return next(c for c in res["conditions"] if c["no"] == no)


# ---------------- SEPA ----------------

def _uptrend(n=260):
    closes = [100 + i * 0.5 for i in range(n)]
    return _bars(closes, highs=[c * 1.01 for c in closes], lows=[c * 0.99 for c in closes])


def test_sepa_under_200_bars_not_evaluable():
    res = Q.compute_sepa_template(_uptrend(199), 90)
    assert res["evaluable"] is False
    assert "200" in res["reason"]
    assert res["pass_count"] == 0 and res["stage"] is None


def test_sepa_full_pass_stage2():
    res = Q.compute_sepa_template(_uptrend(), 80)
    assert res["evaluable"] is True
    assert res["pass_count"] == 8 and res["all_pass"] is True
    assert res["stage"] == 2
    assert [c["no"] for c in res["conditions"]] == list(range(1, 9))


@pytest.mark.parametrize("rs,expected", [(70, True), (69, False)])
def test_sepa_rs_boundary(rs, expected):
    res = Q.compute_sepa_template(_uptrend(), rs)
    assert _cond(res, 8)["pass"] is expected
    assert res["pass_count"] == (8 if expected else 7)


def test_sepa_rs_none_and_short_ma200_history():
    res = Q.compute_sepa_template(_uptrend(210), None)
    assert _cond(res, 8)["pass"] is None
    assert _cond(res, 3)["pass"] is None  # 200일선 20봉 전 값이 없음(220봉 미만)
    assert res["pass_count"] == 6 and res["evaluable_count"] == 6


@pytest.mark.parametrize("last,expected", [(130.0, True), (129.9, False)])
def test_sepa_52w_low_boundary(last, expected):
    closes = [100.0] * 259 + [last]
    res = Q.compute_sepa_template(_bars(closes), 90)
    assert _cond(res, 6)["pass"] is expected


@pytest.mark.parametrize("last,expected", [(150.0, True), (149.9, False)])
def test_sepa_52w_high_boundary(last, expected):
    closes = [100.0] * 259 + [last]
    highs = list(closes)
    highs[100] = 200.0  # 최근 250봉 안의 고점
    res = Q.compute_sepa_template(_bars(closes, highs=highs), 90)
    assert _cond(res, 7)["pass"] is expected


def test_sepa_downtrend_stage4():
    closes = [300 - i * 0.5 for i in range(260)]
    res = Q.compute_sepa_template(_bars(closes), 10)
    assert res["stage"] == 4
    assert res["pass_count"] <= 2


# ---------------- 셋업 백테스트 ----------------

S1 = [1.02, 1.05, 1.10, 1.06, 1.04, 1.03, 1.03, 1.03, 1.03, 0.97,
      1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.08, 1.15, 1.20]
S2 = [0.98, 0.96, 0.95, 0.94, 0.92, 0.93, 0.93, 0.93, 0.93, 0.95,
      0.97, 0.97, 0.97, 0.97, 0.97, 0.97, 0.97, 0.97, 0.97, 0.90]


def _c_series():
    closes = [100.0] * 10
    e1 = 110.0
    closes.append(e1)                       # idx10 신호 1 (+10%)
    closes += [e1 * m for m in S1]          # idx11..30
    e2 = closes[-1] * 1.10
    closes.append(e2)                       # idx31 신호 2 (+10%)
    closes += [e2 * m for m in S2]          # idx32..51
    closes += [closes[-1]] * 8              # idx52..59
    closes.append(closes[-1] * 1.15)        # idx60 신호 3 — 미래 봉 부족
    closes += [closes[-1]] * 4              # idx61..64
    return closes


def test_backtest_c_win_rate_and_avg():
    res = Q.run_setup_backtest(_bars(_c_series()))
    c = res["setups"]["C"]
    assert c["count"] == 2
    assert c["excluded_recent"] == 1
    h = c["horizons"]
    assert h["d3"] == {"win_rate": 50.0, "avg_return": 2.5}
    assert h["d5"] == {"win_rate": 50.0, "avg_return": -2.0}
    assert h["d10"] == {"win_rate": 0.0, "avg_return": -4.0}
    assert h["d20"] == {"win_rate": 50.0, "avg_return": 5.0}
    assert c["mfe_avg"] == 9.0 and c["mae_avg"] == -6.5
    assert res["today"] == []


def test_backtest_empty_setup_stats_none():
    res = Q.run_setup_backtest(_bars([100.0] * 30))
    for k in ("A", "B", "C"):
        s = res["setups"][k]
        assert s["count"] == 0
        assert s["horizons"]["d5"] == {"win_rate": None, "avg_return": None}
        assert s["mfe_avg"] is None


@pytest.mark.parametrize("vol,fires", [(1500, True), (1400, False)])
def test_setup_a_golden_cross_volume_boundary(vol, fires):
    closes = [100.0] * 30 + [105.0]
    vols = [1000] * 30 + [vol]
    res = Q.run_setup_backtest(_bars(closes, vols=vols))
    assert ("A" in res["today"]) is fires
    assert "C" not in res["today"]


def _b_series(low_mult):
    closes = [100 + i * 0.5 for i in range(60)]
    ma20 = sum(closes[-20:]) / 20
    lows = list(closes)
    lows[-1] = ma20 * low_mult
    return _bars(closes, lows=lows)


@pytest.mark.parametrize("low_mult,fires", [(1.005, True), (1.02, False)])
def test_setup_b_pullback(low_mult, fires):
    res = Q.run_setup_backtest(_b_series(low_mult))
    assert ("B" in res["today"]) is fires


def test_setup_c_today():
    res = Q.run_setup_backtest(_bars([100.0] * 30 + [110.0]))
    assert "C" in res["today"]
    assert res["setups"]["C"]["count"] == 0 and res["setups"]["C"]["excluded_recent"] == 1


# ---------------- 시장 폭 ----------------

def _rows(n_above20, n_above50, total=10):
    return [{"close": 100.0, "ma20": 90.0 if i < n_above20 else 110.0, "ma50": 90.0 if i < n_above50 else 110.0}
            for i in range(total)]


@pytest.mark.parametrize("a20,a50,regime,risk", [
    (6, 6, "BULL", [1.5, 2.0]),
    (6, 5, "CHOPPY", [0.5, 1.0]),
    (5, 6, "CHOPPY", [0.5, 1.0]),
    (3, 3, "BEAR", [0.0, 0.5]),
    (4, 3, "CHOPPY", [0.5, 1.0]),
])
def test_market_breadth_regime_boundaries(a20, a50, regime, risk):
    res = Q.compute_market_breadth(_rows(a20, a50))
    assert res["pct_above_ma20"] == a20 * 10.0 and res["pct_above_ma50"] == a50 * 10.0
    assert res["regime"] == regime
    assert res["risk_range_pct"] == risk
    assert res["count"] == 10


def test_market_breadth_skips_missing_and_empty():
    rows = _rows(6, 6) + [{"close": 100.0, "ma20": None, "ma50": 0.0}]
    assert Q.compute_market_breadth(rows)["count"] == 10
    empty = Q.compute_market_breadth([])
    assert empty["regime"] is None and empty["count"] == 0


# ---------------- 손절·포지션 ----------------

def test_suggest_stop_uses_higher_of_pct_and_low10():
    lows = [100.0] * 20
    lows[-3] = 95.0
    res = Q.suggest_stop(_bars([100.0] * 20, lows=lows))
    assert res["stop"] == 95.0 and "10봉" in res["basis"]
    lows[-3] = 90.0
    res = Q.suggest_stop(_bars([100.0] * 20, lows=lows))
    assert res["stop"] == 92.0 and "8%" in res["basis"]


def test_suggest_stop_low10_equal_close_falls_back_to_pct():
    res = Q.suggest_stop(_bars([100.0] * 20))
    assert res["stop"] == 92.0


def test_position_size_floors_shares():
    res = Q.position_size(10_000_000, 1.0, 10_000, 9_300)
    assert res["shares"] == 142  # 100,000 ÷ 700 = 142.86 → 내림
    assert res["amount"] == 1_420_000
    assert res["weight_pct"] == 14.2
    assert res["max_loss"] == 99_400
    assert res["capped_by_capital"] is False


def test_position_size_capped_by_capital():
    res = Q.position_size(1_000_000, 2.0, 10_000, 9_990)
    assert res["shares"] == 100 and res["capped_by_capital"] is True


@pytest.mark.parametrize("stop", [10_000, 10_500])
def test_position_size_stop_not_below_entry_errors(stop):
    with pytest.raises(ValueError):
        Q.position_size(10_000_000, 1.0, 10_000, stop)


# ---------------- DART ----------------

def test_classify_dart_tags():
    titles = [
        "단일판매ㆍ공급계약체결", "주요사항보고서(자기주식취득결정)", "주요사항보고서(자기주식소각결정)",
        "주요사항보고서(무상증자결정)", "연결재무제표기준영업(잠정)실적(공정공시)",
        "주요사항보고서(유상증자결정)", "주요사항보고서(전환사채권발행결정)",
        "주요사항보고서(신주인수권부사채권발행결정)", "주요사항보고서(교환사채권발행결정)",
        "전환청구권행사", "감사보고서제출(감사의견거절)", "관리종목지정",
        "주요사항보고서(자기주식처분결정)", "임원ㆍ주요주주특정증권등소유상황보고서",
    ]
    res = Q.classify_dart([{"report_nm": t, "rcept_dt": "20261120", "rcept_no": str(i)}
                           for i, t in enumerate(titles)])
    tags = [it["tag"] for it in res["items"]]
    assert tags[:5] == ["positive"] * 5
    assert tags[5:12] == ["negative"] * 7
    assert tags[12:] == [None, None]  # 자기주식처분은 호재 아님
    assert res["positive_count"] == 5 and res["negative_count"] == 7
    assert res["overhang"] is True and res["fatal"] is True
    assert "CB" in res["items"][6]["labels"]


def test_classify_dart_unfaithful_disclosure_negative_not_overhang():
    res = Q.classify_dart([{"report_nm": "불성실공시법인지정", "rcept_dt": "20261120", "rcept_no": "1"}])
    assert res["items"][0]["tag"] == "negative"
    assert res["overhang"] is False and res["fatal"] is False


def test_classify_dart_positive_only():
    res = Q.classify_dart([{"report_nm": "[기재정정]단일판매ㆍ공급계약체결", "rcept_dt": "20261120",
                            "rcept_no": "1"}])
    assert res["overhang"] is False and res["fatal"] is False
    assert res["items"][0]["tag"] == "positive" and res["items"][0]["corrected"] is True


# ---------------- 업종 비교 ----------------

def test_peer_valuation_median_excludes_non_positive_eps_and_target():
    target = {"ticker": "T", "close": 10_000, "eps": 1_000, "bps": 5_000, "roe": 12.0}
    peers = [
        target,
        {"ticker": "A", "close": 10_000, "eps": 1_000, "bps": 10_000, "roe": 10.0},
        {"ticker": "B", "close": 10_000, "eps": 500, "bps": 5_000, "roe": 8.0},
        {"ticker": "C", "close": 10_000, "eps": -100, "bps": 2_500, "roe": -3.0},
        {"ticker": "D", "close": 10_000, "eps": 0, "bps": 0, "roe": None},
        {"ticker": "E", "close": 10_000, "eps": 2_000, "bps": None, "roe": 20.0},
    ]
    res = Q.peer_valuation(target, peers)
    assert res["target"] == {"per": 10.0, "pbr": 2.0, "roe": 12.0}
    assert res["median"]["per"] == 10.0  # [10, 20, 5]
    assert res["sample"] == {"per": 3, "pbr": 3, "roe": 4}
    assert res["median"]["pbr"] == 2.0  # [1, 2, 4]
    assert res["median"]["roe"] == 9.0  # [10, 8, -3, 20]
    assert res["gap_pct"] == {"per": 0.0, "pbr": 0.0, "roe": 33.33}


def test_peer_valuation_negative_target_eps():
    res = Q.peer_valuation({"ticker": "T", "close": 100, "eps": -5, "bps": 50, "roe": -1.0},
                           [{"ticker": "A", "close": 100, "eps": 10, "bps": 50, "roe": 5.0}])
    assert res["target"]["per"] is None and res["gap_pct"]["per"] is None


# ---------------- 분기 이익 흐름 ----------------

def _q(ym, op, debt=100.0):
    return {"stac_yymm": ym, "op_growth": op, "sales_growth": 1.0, "ni_growth": 2.0, "debt_ratio": debt}


def test_earnings_trend_accelerating_sorted_last4():
    res = Q.earnings_trend([_q("202606", 30.0), _q("202503", 99.0), _q("202509", 10.0),
                            _q("202512", 5.0), _q("202603", 20.0)])
    assert res["op_growth_series"] == [10.0, 5.0, 20.0, 30.0]
    assert [q["stac_yymm"] for q in res["quarters"]] == ["202509", "202512", "202603", "202606"]
    assert res["accelerating"] is True and res["decelerating"] is False
    assert res["latest"]["stac_yymm"] == "202606"


def test_earnings_trend_decelerating_and_short():
    res = Q.earnings_trend([_q("202512", 30.0), _q("202603", 20.0), _q("202606", 10.0)])
    assert res["accelerating"] is False and res["decelerating"] is True
    short = Q.earnings_trend([_q("202606", 10.0)])
    assert short["accelerating"] is None
    assert Q.earnings_trend([])["latest"] is None

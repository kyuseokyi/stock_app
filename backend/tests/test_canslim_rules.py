"""CANSLIM 판정 규칙(순수 함수) — 경계값·데이터 부족·흑자 전환·누적→단독 분기·RS 백분위·시장 상태·점수."""
import pytest

from apps.collector.canslim import rules as r


# ---------------------------------------------------------------- C (분기)
def test_shift_months():
    assert r.shift_yymm("202603", -3) == "202512" and r.shift_yymm("202512", 3) == "202603"
    assert r.shift_yymm("202606", -12) == "202506"


def test_standalone_quarters_not_cumulative():
    rows = [("202603", 100.0), ("202606", None), ("202609", 120.0)]
    assert r.standalone_quarters(rows, 12, False) == {"202603": 100.0, "202609": 120.0}


def test_standalone_quarters_cumulative_dec_fiscal():
    # 12월 결산: 3월=1분기(그대로), 6월=누적-3월, 9월=누적-6월
    rows = [("202603", 100.0), ("202606", 250.0), ("202609", 330.0), ("202612", 500.0)]
    assert r.standalone_quarters(rows, 12, True) == {"202603": 100.0, "202606": 150.0, "202609": 80.0,
                                                     "202612": 170.0}


def test_standalone_quarters_cumulative_march_fiscal_and_gap():
    # 3월 결산: 6월이 1분기(그대로). 12월은 9월 누적이 없어 제외, 3월은 12월 누적을 뺀다
    rows = [("202506", 40.0), ("202512", 130.0), ("202603", 200.0)]
    assert r.standalone_quarters(rows, 3, True) == {"202506": 40.0, "202603": 70.0}


def test_eval_c_pending_when_format_unknown():
    assert r.eval_c([("202606", 1.0), ("202506", 1.0)], 12, None).status == r.PENDING


@pytest.mark.parametrize("cur, prev, status", [(125.0, 100.0, r.PASS), (124.9, 100.0, r.FAIL)])
def test_eval_c_growth_boundary(cur, prev, status):
    v = r.eval_c([("202506", prev), ("202606", cur)], 12, False)
    assert v.status == status and v.value == pytest.approx((cur / prev - 1) * 100)
    assert v.extra["quarter"] == "202606"


def test_eval_c_turnaround_and_missing():
    v = r.eval_c([("202506", -10.0), ("202606", 5.0)], 12, False)
    assert v.status == r.PASS and v.extra["turnaround"] is True and v.value is None
    assert r.eval_c([("202506", -10.0), ("202606", -1.0)], 12, False).status == r.FAIL
    assert r.eval_c([("202603", 1.0), ("202606", 2.0)], 12, False).status == r.NA  # 전년 같은 분기 없음
    assert r.eval_c([], 12, False).status == r.NA


# ---------------------------------------------------------------- A (연간)
def test_eval_a_pass_and_boundaries():
    rows = [("202212", 100.0, 20.0), ("202312", 130.0, 20.0), ("202412", 160.0, 20.0), ("202512", 200.0, 18.0)]
    v = r.eval_a(rows)
    assert v.status == r.PASS and v.value == pytest.approx(((200 / 100) ** (1 / 3) - 1) * 100)
    assert v.extra["roe"] == 18.0
    assert r.eval_a(rows[:-1] + [("202512", 200.0, 16.9)]).status == r.FAIL          # ROE 미달
    assert r.eval_a(rows[:2] + [("202412", 120.0, 20.0), ("202512", 200.0, 20.0)]).status == r.FAIL  # 한 해 감소
    slow = [("202212", 100.0, 20.0), ("202312", 110.0, 20.0), ("202412", 120.0, 20.0), ("202512", 130.0, 20.0)]
    assert r.eval_a(slow).status == r.FAIL                                              # CAGR < 25
    assert r.eval_a(rows[:3]).status == r.NA                                            # 4년 미만
    assert r.eval_a([("202212", -5.0, 1.0)] + rows[1:]).status == r.FAIL                # 기준 연도 적자
    turned_loss = r.eval_a(rows[:3] + [("202512", -40.0, -3.0)])                        # 최근 연도 적자 전환
    assert turned_loss.status == r.FAIL and turned_loss.value is None                   # 복소수 CAGR 저장 실패 방지



def test_closed_years_drops_partial_latest_row():
    rows = [("202312", 1.0), ("202412", 2.0), ("202512", 3.0), ("202606", 9.0)]
    assert r.closed_years(rows) == rows[:3]                          # 진행 중인 해(상반기 누적) 제외
    assert r.closed_years(rows[:3]) == rows[:3]                      # 최신 행이 결산월이면 그대로
    assert r.closed_years([("202606", 9.0)]) == [("202606", 9.0)]    # 한 행뿐이면 판단 불가 — 그대로
    assert r.closed_years([("202403", 1.0), ("202503", 2.0), ("202509", 3.0)]) == [("202403", 1.0), ("202503", 2.0)]


def test_eval_a_ignores_partial_year():
    rows = [("202212", 100.0, 20.0), ("202312", 130.0, 20.0), ("202412", 160.0, 20.0), ("202512", 200.0, 18.0)]
    v = r.eval_a(rows + [("202606", 50.0, 9.0)])                     # 상반기 누적이 최신 행으로 붙어도
    assert v.status == r.PASS and v.extra["years"][-1] == "202512" and v.extra["roe"] == 18.0

# ---------------------------------------------------------------- N·S
def test_eval_n():
    highs = [100.0] * 60
    assert r.eval_n(highs, [85.0] * 60).status == r.PASS
    v = r.eval_n(highs, [84.9] * 60)
    assert v.status == r.FAIL and v.value == pytest.approx(-15.1) and v.extra["high_52w"] == 100.0
    assert r.eval_n(highs[:59], [90.0] * 59).status == r.NA
    old_peak = [500.0] + [100.0] * 252  # 253봉 전 고점은 52주 밖
    assert r.eval_n(old_peak, [95.0] * 253).status == r.PASS


def test_eval_s():
    closes = [10.0]
    vols = [0.0]
    for i in range(50):  # 상승일 거래량 200, 하락일 100 — 번갈아
        closes.append(closes[-1] + (1 if i % 2 == 0 else -0.5))
        vols.append(200.0 if i % 2 == 0 else 100.0)
    v = r.eval_s(closes, vols)
    assert v.status == r.PASS and v.value == pytest.approx(2.0)
    assert r.eval_s(closes[:50], vols[:50]).status == r.NA
    down_only = [float(100 - i) for i in range(51)]
    assert r.eval_s(down_only, [1.0] * 51).status == r.FAIL
    up_only = [float(i + 1) for i in range(51)]
    assert r.eval_s(up_only, [1.0] * 51).value == 99.0  # 하락일 없음 → 상한


# ---------------------------------------------------------------- L (RS)
def test_rs_raw_weights():
    closes = [100.0] * 253
    closes[-1 - 63] = 50.0  # 3개월 수익률 +100%
    assert r.rs_raw(closes) == pytest.approx(0.4 * 1.0)
    assert r.rs_raw(closes[:252]) is None


def test_rs_percentiles_ranks_and_ties():
    raws = {f"T{i}": float(i) for i in range(100)}
    raws["NONE"] = None
    p = r.rs_percentiles(raws)
    assert "NONE" not in p and p["T0"] == 1 and p["T99"] == 99 and 45 <= p["T50"] <= 55
    tie = r.rs_percentiles({"A": 1.0, "B": 1.0})
    assert tie["A"] == tie["B"] == 50
    assert r.rs_percentiles({}) == {}


def test_eval_l():
    assert r.eval_l(80).status == r.PASS and r.eval_l(79).status == r.FAIL and r.eval_l(None).status == r.NA


# ---------------------------------------------------------------- I
def test_eval_i():
    v = r.eval_i([10] * 10 + [-1] * 10)
    assert v.status == r.PASS and v.value == 90 and v.extra["buy_days"] == 10
    assert r.eval_i([10] * 9 + [-1] * 11).status == r.FAIL      # 순매수 9일
    assert r.eval_i([1] * 10 + [-100] * 10).status == r.FAIL     # 합계 음수
    assert r.eval_i([1] * 14).status == r.NA


# ---------------------------------------------------------------- M
def _rising(n=220):
    return [100.0 + i for i in range(n)], [1000.0] * n


def test_market_state_uptrend():
    closes, vols = _rising()
    s = r.market_state(closes, vols)
    assert s.passed and s.status == "상승 추세" and s.dist_days == 0
    assert r.eval_m(s).status == r.PASS


def test_market_state_distribution_days_and_downtrend():
    closes, vols = _rising()
    for k in range(5):  # 최근 25일 안에 분산일 5번(0.5% 하락 + 거래량 증가)
        i = len(closes) - 2 - k * 4
        closes[i] = closes[i - 1] * 0.995
        vols[i] = vols[i - 1] + 500
    s = r.market_state(closes, vols)
    assert s.dist_days == 5 and not s.passed and s.status == "조정"
    down = [300.0 - i for i in range(220)]
    assert r.market_state(down, [1.0] * 220).status == "하락"
    assert r.market_state(closes[:199], vols[:199]) is None
    assert r.eval_m(None).status == r.NA


# ---------------------------------------------------------------- 유동성·점수
def test_liquidity():
    assert r.is_liquid([1000.0] * 20, [1_000_000.0] * 20) == (True, 1e9)
    assert r.is_liquid([999.0] * 20, [10_000_000.0] * 20)[0] is False   # 주가 1,000원 미만
    assert r.is_liquid([1000.0] * 19, [1e9] * 19) == (False, None)


def test_score_weights():
    v = {k: r.Verdict(r.FAIL) for k in r.WEIGHTS}
    v["c"] = r.Verdict(r.PASS)
    v["l"] = r.Verdict(r.PASS)
    v["m"] = r.Verdict(r.PENDING)
    assert r.score(v) == (40, 2)
    assert sum(r.WEIGHTS.values()) == 100

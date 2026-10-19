"""표본 점검 판정(순수) — KRX 비교 분류, 종가·1일 등락 재계산, 그룹 평균 재현·drift, 이름 중복, 종료 코드."""
from __future__ import annotations

import pytest

from apps.collector.verify import checks as ck
from apps.collector.verify.checks import Bar

KRX = Bar(100, 110, 95, 105, 1000)


def test_judge_exact_when_volume_and_prices_equal():
    assert ck.judge_bar(Bar(100, 110, 95, 105, 1000), KRX) == (ck.EXACT, [])


def test_judge_consistent_un_superset():
    # 통합(UN) 시세: 시가·종가는 달라도 되고 고가≥·저가≤·거래량≥ 이면 정상
    assert ck.judge_bar(Bar(99, 112, 94, 104, 1500), KRX) == (ck.CONSISTENT, [])


@pytest.mark.parametrize("ours, word", [
    (Bar(100, 109, 95, 105, 1500), "고가"),
    (Bar(100, 110, 96, 105, 1500), "저가"),
    (Bar(100, 110, 95, 105, 900), "거래량"),
])
def test_judge_violation_reasons(ours, word):
    status, reasons = ck.judge_bar(ours, KRX)
    assert status == ck.VIOLATION and len(reasons) == 1 and reasons[0].startswith(word)


def test_judge_equal_volume_requires_equal_prices():
    # 거래량이 같다 = 넥스트레이드 미상장 → OHLC 도 KRX 와 같아야 한다
    assert ck.judge_bar(Bar(100, 110, 95, 104, 1000), KRX) == (ck.VIOLATION, ["종가 104 ≠ KRX 105"])


def test_judge_missing():
    assert ck.judge_bar(KRX, None) == (ck.MISSING, [])
    assert ck.judge_bar(KRX, Bar(0, 0, 0, 0, 0)) == (ck.MISSING, [])


def test_reason_numbers_are_readable():
    _, reasons = ck.judge_bar(Bar(1_000_000, 1_000_000, 1, 1, 5), Bar(1, 1_200_000, 1, 1, 9))
    assert reasons == ["고가 1,000,000 < KRX 1,200,000", "거래량 5 < KRX 9"]


def test_check_stock_rows():
    rows = {
        "A": {"close": 110.0, "chg_1d": 10.0},        # 정상
        "B": {"close": 51.0, "chg_1d": 0.0},          # (a) 종가 다름
        "C": {"close": 30.0, "chg_1d": 5.0},          # (b) 직전 봉 없음 → None 이어야
        "D": {"close": 20.0, "chg_1d": None},         # 직전 봉 없음 + None → 정상
        "E": {"close": 9.0, "chg_1d": None},          # 그날 일봉 없음
        "F": {"close": 100.0, "chg_1d": 25.0000001},  # 허용 오차 안
        "G": {"close": 10.0, "chg_1d": None},         # 직전 종가 0 → None
    }
    closes = {"A": 110.0, "B": 50.0, "C": 30.0, "D": 20.0, "F": 100.0, "G": 10.0}
    prev = {"A": 100.0, "B": 50.0, "F": 80.0, "G": 0.0}
    out = ck.check_stock_rows(rows, closes, prev)
    assert [(m["check"], m["ticker"]) for m in out] == [("close", "B"), ("chg_1d", "C"), ("close", "E")]
    assert out[0] == {"check": "close", "ticker": "B", "ours": 51.0, "expected": 50.0}
    assert out[1]["expected"] is None and out[2]["expected"] is None


def _stocks():
    return {
        "A": {"chg_1d": 10.0, "sector_m": "0013"},
        "B": {"chg_1d": -20.0, "sector_m": "0013"},
        "C": {"chg_1d": None, "sector_m": "0013"},   # 구성 수엔 들어가고 평균에선 빠진다
        "H": {"chg_1d": 50.0, "sector_m": "0013"},   # 거래정지
        "X": {"chg_1d": 1.0, "sector_m": ""},         # 업종 없음
    }


def test_expected_groups_mirrors_aggregate():
    themes = {"7": ("반도체", ["A", "A", "B", "ZZ", "H"]), "9": ("빈", ["ZZ"]), "10": ("정지만", ["H"])}
    exp = ck.expected_groups(_stocks(), themes, halted={"H"})
    assert exp[("theme", "7")] == {"members": 2, "chg_1d": pytest.approx(-5.0)}
    assert exp[("sector", "0013")] == {"members": 3, "chg_1d": pytest.approx(-5.0)}
    assert ("theme", "9") not in exp and ("theme", "10") not in exp
    assert set(exp) == {("theme", "7"), ("sector", "0013")}


def test_check_groups_mismatch_vs_drift():
    exp = {("sector", "0013"): {"members": 3, "chg_1d": -5.0}, ("theme", "7"): {"members": 2, "chg_1d": -5.0},
           ("theme", "11"): {"members": 5, "chg_1d": 1.0}, ("theme", "12"): {"members": 1, "chg_1d": None}}
    rows = [
        {"kind": "sector", "group_id": "0013", "name": "전기·전자", "members": 3, "chg_1d": -5.0000000001},  # 정상
        {"kind": "theme", "group_id": "7", "name": "반도체", "members": 2, "chg_1d": 1.0},     # 불일치
        {"kind": "theme", "group_id": "8", "name": "사라짐", "members": 4, "chg_1d": 1.0},     # 재현 없음 → drift
        {"kind": "theme", "group_id": "11", "name": "바뀜", "members": 4, "chg_1d": 1.0},      # 구성 수 다름 → drift
        {"kind": "theme", "group_id": "12", "name": "값 없음", "members": 1, "chg_1d": None},  # None == None 정상
    ]
    mism, drift = ck.check_groups(rows, exp)
    assert [(m["group_id"], m["ours"], m["expected"]) for m in mism] == [("7", 1.0, -5.0)]
    assert [(d["group_id"], d["members"], d["expected_members"]) for d in drift] == [("8", 4, 0), ("11", 4, 5)]


def test_duplicate_names_same_kind_only():
    rows = [{"kind": "sector", "group_id": "0151", "name": "의료·정밀기기"},
            {"kind": "sector", "group_id": "0021", "name": "의료·정밀기기"},
            {"kind": "theme", "group_id": "3", "name": "의료·정밀기기"},
            {"kind": "theme", "group_id": "4", "name": "반도체"}]
    assert ck.duplicate_names(rows) == [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0151"]}]


def _result(external=(), **internal):
    base = {"stock_mismatches": [], "group_mismatches": [], "group_drifts": [], "duplicates": []}
    return {"external": [{"status": s} for s in external], "internal": base | internal}


def test_exit_code():
    assert ck.exit_code(_result([ck.EXACT, ck.CONSISTENT, ck.MISSING, ck.ERROR],
                                group_drifts=[{}], duplicates=[{}])) == 0   # 경고만
    assert ck.exit_code(_result([ck.VIOLATION])) == 1
    assert ck.exit_code(_result(stock_mismatches=[{}])) == 1
    assert ck.exit_code(_result(group_mismatches=[{}])) == 1

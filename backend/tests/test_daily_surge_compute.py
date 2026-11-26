"""급등락·테마 분석 순수 계산 — 등락률·분류 경계·거래대금 순위·테마 묶음·대장주·대표 테마·공시 키워드·뉴스 시각 배지."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from apps.collector.daily_surge import compute as C

KST = timezone(timedelta(hours=9))
T = date(2026, 11, 26)
P = date(2026, 11, 25)


def _profiles(*tickers, common=True, market="KOSDAQ"):
    return {t: (market, common) for t in tickers}


def _rows(spec: dict[str, tuple[float, float, int]], top_n: int = 50):
    """spec = {ticker: (prev_close, close, volume)} → 분류까지 끝난 종목 행."""
    today = {t: (c, v) for t, (_p, c, v) in spec.items()}
    prev = {t: (p, 100) for t, (p, _c, _v) in spec.items()}
    rows = C.build_rows(today, prev, _profiles(*spec), {t: f"종목{t}" for t in spec})
    return C.classify(rows, top_n=top_n)


# ------------------------------------------------------------------ 종목 행
def test_build_rows_values():
    rows = C.build_rows({"A": (11000.0, 300)}, {"A": (10000.0, 100)}, _profiles("A"), {"A": "가"})
    (r,) = rows
    assert r["ticker"] == "A" and r["name"] == "가" and r["market"] == "KOSDAQ"
    assert r["prev_close"] == 10000.0 and r["close"] == 11000.0
    assert r["change_price"] == 1000.0
    assert r["change_rate"] == 10.0
    assert r["trading_value"] == 11000.0 * 300
    assert r["volume_ratio"] == 300.0


def test_build_rows_rounding_and_zero_prev_volume():
    rows = C.build_rows({"A": (10333.0, 10)}, {"A": (9000.0, 0)}, _profiles("A"), {})
    (r,) = rows
    assert r["change_rate"] == 14.81  # 14.8111…
    assert r["volume_ratio"] is None
    assert r["name"] == "A"  # 이름이 없으면 코드


def test_build_rows_excludes_non_common_missing_profile_and_missing_prev():
    today = {"A": (110.0, 1), "B": (110.0, 1), "C": (110.0, 1), "D": (110.0, 1)}
    prev = {"A": (100.0, 1), "B": (100.0, 1), "C": (100.0, 1)}  # D 는 전일 없음
    profiles = {"A": ("KOSPI", True), "B": ("KOSPI", False), "D": ("KOSPI", True)}  # C 프로필 없음
    rows = C.build_rows(today, prev, profiles, {})
    assert [r["ticker"] for r in rows] == ["A"]


def test_build_rows_skips_zero_prev_close():
    assert C.build_rows({"A": (110.0, 1)}, {"A": (0.0, 1)}, _profiles("A"), {}) == []


# ------------------------------------------------------------------ 분류 경계
@pytest.mark.parametrize("close,surge,plunge", [
    (110.0, True, False),     # +10.0
    (130.5, True, False),     # +30.5
    (109.99, False, False),   # +9.99
    (130.51, False, False),   # +30.51
    (90.0, False, True),      # -10.0
    (69.5, False, True),      # -30.5
    (69.49, False, False),    # -30.51
    (90.01, False, False),    # -9.99
])
def test_classify_bounds(close, surge, plunge):
    (r,) = _rows({"A": (100.0, close, 10)})
    assert r["is_surge"] is surge
    assert r["is_plunge"] is plunge


def test_ranks_and_top_value():
    rows = _rows({
        "A": (100.0, 120.0, 10),    # +20%, 대금 1200
        "B": (100.0, 125.0, 100),   # +25%, 대금 12500
        "C": (100.0, 80.0, 50),     # -20%, 대금 4000
        "D": (100.0, 85.0, 1),      # -15%, 대금 85
        "E": (100.0, 101.0, 1000),  # +1%, 대금 101000
    }, top_n=2)
    by = {r["ticker"]: r for r in rows}
    assert (by["B"]["surge_rank"], by["A"]["surge_rank"]) == (1, 2)
    assert (by["C"]["plunge_rank"], by["D"]["plunge_rank"]) == (1, 2)
    assert by["E"]["surge_rank"] is None and by["E"]["plunge_rank"] is None
    assert [by[t]["value_rank"] for t in "EBCAD"] == [1, 2, 3, 4, 5]
    assert {t for t, r in by.items() if r["is_top_value"]} == {"E", "B"}


def test_targets_are_union():
    rows = _rows({"A": (100.0, 120.0, 1), "B": (100.0, 101.0, 10_000), "C": (100.0, 101.0, 1)}, top_n=1)
    assert {r["ticker"] for r in C.targets(rows)} == {"A", "B"}


# ------------------------------------------------------------------ 테마 묶음
def test_theme_groups_two_or_more_same_direction():
    rows = _rows({
        "A": (100.0, 120.0, 10),   # up, 1200
        "B": (100.0, 115.0, 20),   # up, 2300
        "C": (100.0, 85.0, 10),    # down
        "D": (100.0, 103.0, 10),   # 기준 미달
    })
    themes = {1: ("화장품", ["A", "B", "C", "D"]), 2: ("보안", ["A", "D"])}
    groups = C.theme_groups(rows, themes)
    assert len(groups) == 1
    g = groups[0]
    assert (g["theme_id"], g["theme_name"], g["direction"], g["stock_count"]) == (1, "화장품", "up", 2)
    assert g["avg_change_rate"] == 17.5
    assert g["value_sum"] == 1200.0 + 2300.0
    assert (g["leader_ticker"], g["leader_name"]) == ("B", "종목B")
    assert g["members"] == ["B", "A"]  # 거래대금 내림차순


def test_theme_groups_down_direction_and_leader_ties():
    rows = _rows({
        "A": (100.0, 80.0, 10),   # -20%, 800
        "B": (100.0, 89.0, 10),   # -11%, 890
        "C": (100.0, 80.0, 10),   # -20%, 800 (A 와 대금·등락률 같음)
    })
    g1 = C.theme_groups(rows, {7: ("바이오", ["A", "B"])})[0]
    assert g1["direction"] == "down" and g1["leader_ticker"] == "B"  # 거래대금 1위
    g2 = C.theme_groups(rows, {8: ("x", ["C", "A"])})[0]
    assert g2["leader_ticker"] == "A"  # 대금·|등락률| 같으면 코드 오름차순


def test_theme_groups_leader_tie_by_abs_rate():
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 112.0, 10)})  # 대금 1200 vs 1120 → A
    rows2 = _rows({"A": (200.0, 240.0, 5), "B": (100.0, 120.0, 10)})  # 대금 1200 동일, 등락률 20 동일 → 코드
    assert C.theme_groups(rows, {1: ("t", ["A", "B"])})[0]["leader_ticker"] == "A"
    assert C.theme_groups(rows2, {1: ("t", ["B", "A"])})[0]["leader_ticker"] == "A"


# ------------------------------------------------------------------ 대표 테마
def test_assign_primary_prefers_bigger_group():
    rows = _rows({
        "A": (100.0, 120.0, 10), "B": (100.0, 120.0, 10), "C": (100.0, 120.0, 10),
        "D": (100.0, 120.0, 100),
    })
    themes = {5: ("큰묶음", ["A", "B", "C"]), 3: ("작은묶음", ["A", "D"])}
    groups = C.theme_groups(rows, themes)
    C.assign_primary(rows, groups)
    by = {r["ticker"]: r for r in rows}
    assert by["A"]["primary_theme_id"] == 5          # 종목 수 많은 쪽
    assert by["D"]["primary_theme_id"] == 3 and by["D"]["primary_theme_name"] == "작은묶음"
    assert by["D"]["is_theme_leader"] is True
    assert by["A"]["is_theme_leader"] is True    # 묶음 5 안에서 대금·등락률 동률 → 코드 A
    assert by["B"]["is_theme_leader"] is False


def test_assign_primary_value_then_id():
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 120.0, 10), "C": (100.0, 120.0, 50)})
    groups = C.theme_groups(rows, {9: ("x", ["A", "B"]), 4: ("y", ["A", "B"]), 2: ("z", ["A", "C"])})
    C.assign_primary(rows, groups)
    by = {r["ticker"]: r for r in rows}
    assert by["A"]["primary_theme_id"] == 2   # 같은 2종목이면 대금 합 큰 쪽
    assert by["B"]["primary_theme_id"] == 4   # 대금 합도 같으면 id 작은 쪽


def test_assign_primary_none_for_value_only_and_solo():
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 101.0, 999)})
    C.assign_primary(rows, C.theme_groups(rows, {1: ("t", ["A", "B"])}))
    for r in rows:
        assert r["primary_theme_id"] is None and r["primary_theme_name"] is None and r["is_theme_leader"] is False


# ------------------------------------------------------------------ 공시
def test_dart_keywords():
    titles = ["[기재정정]주주배정 유상증자 결정", "단일판매ㆍ공급계약체결", "주주배정후 실권주 일반공모 유상증자"]
    assert C.dart_keywords(titles) == ["#유상증자", "#공급계약"]
    assert C.dart_keywords(["전환사채권발행결정", "임원ㆍ주요주주특정증권등소유상황보고서"]) == ["#전환사채"]
    assert C.dart_keywords([]) == []


def test_dart_items_when():
    items = C.dart_items([("20261125", "R1", "유상증자 결정"), ("20261126", "R2", "공급계약")], T)
    assert [i["when"] for i in items] == ["prev", "same"]
    assert items[0]["url"].endswith("R1") and items[0]["title"] == "유상증자 결정"
    assert items[1]["rcept_no"] == "R2" and items[1]["rcept_dt"] == "20261126"


# ------------------------------------------------------------------ 뉴스 시각 배지
@pytest.mark.parametrize("dt,slot", [
    (datetime(2026, 11, 25, 15, 29, tzinfo=KST), "other"),
    (datetime(2026, 11, 25, 15, 30, tzinfo=KST), "pre"),
    (datetime(2026, 11, 26, 8, 59, tzinfo=KST), "pre"),
    (datetime(2026, 11, 26, 9, 0, tzinfo=KST), "intra"),
    (datetime(2026, 11, 26, 15, 30, tzinfo=KST), "intra"),
    (datetime(2026, 11, 26, 15, 31, tzinfo=KST), "post"),
    (datetime(2026, 11, 26, 23, 59, tzinfo=KST), "post"),
    (datetime(2026, 11, 27, 0, 0, tzinfo=KST), "other"),
    (datetime(2026, 11, 26, 0, 10, tzinfo=timezone.utc), "intra"),  # 00:10Z = 09:10 KST
    (None, "other"),
])
def test_time_slot(dt, slot):
    assert C.time_slot(dt, T, P) == slot


def test_parse_pub_date():
    assert C.parse_pub_date("Thu, 26 Nov 2026 08:12:00 +0900") == datetime(2026, 11, 26, 8, 12, tzinfo=KST)
    assert C.parse_pub_date("") is None
    assert C.parse_pub_date("아무 글자") is None


# ------------------------------------------------------------------ 넓은 테마·소속 테마 목록 (2026-11-27)
def test_assign_primary_prefers_specific_theme_over_huge_one():
    """300종목짜리 넓은 테마에 급등 3개가 껴도, 4종목짜리 테마에서 2개가 함께 오른 쪽이 대표."""
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 118.0, 10), "C": (100.0, 115.0, 10)})
    huge = ["A", "B", "C"] + [f"Z{i:03d}" for i in range(297)]
    groups = C.theme_groups(rows, {1: ("신규상장", huge), 2: ("화장품", ["A", "B", "X1", "X2"])})
    assert {g["theme_id"]: g["theme_size"] for g in groups} == {1: 300, 2: 4}
    C.assign_primary(rows, groups)
    by = {r["ticker"]: r for r in rows}
    assert by["A"]["primary_theme_name"] == "화장품" and by["B"]["primary_theme_name"] == "화장품"
    assert by["C"]["primary_theme_name"] == "신규상장"  # C 는 넓은 테마에만 함께 움직인 종목이 있음


def test_stock_theme_lists_for_solo_and_value_only():
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 118.0, 10), "S": (100.0, 125.0, 10),
                  "V": (100.0, 101.0, 9999)})
    themes = {1: ("화장품", ["A", "B", "Q"]), 2: ("중국 소비", ["A", "S", "V", "Q", "R"]), 3: ("보안", ["S"])}
    groups = C.theme_groups(rows, themes)
    C.stock_theme_lists(rows, themes, groups)
    by = {r["ticker"]: r for r in rows}
    assert [t["name"] for t in by["A"]["themes"]] == ["화장품", "중국 소비"]
    assert by["A"]["themes"][0] == {"id": 1, "name": "화장품", "size": 3, "moved": 2, "source": None}
    # S: '중국 소비'에서 A 와 함께 급등(moved 2) → 먼저, '보안'은 혼자(moved 0)
    assert [(t["name"], t["moved"]) for t in by["S"]["themes"]] == [("중국 소비", 2), ("보안", 0)]
    assert [t["name"] for t in by["V"]["themes"]] == ["중국 소비"]  # 거래대금 상위만인 종목도 테마 표시


def test_stock_theme_lists_limit():
    rows = _rows({"A": (100.0, 120.0, 10)})
    themes = {i: (f"t{i}", ["A"] + [f"x{j}" for j in range(i)]) for i in range(1, 9)}
    C.stock_theme_lists(rows, themes, [])
    assert [t["id"] for t in rows[0]["themes"]] == [1, 2, 3, 4, 5]



def test_fill_fallback_themes_only_for_stocks_without_primary_source():
    """키움 테마가 없는 종목에만 KIS 테마를 보충하고 source='kis' 로 표시. 키움 테마가 있으면 그대로."""
    rows = _rows({"A": (100.0, 120.0, 10), "B": (100.0, 118.0, 10), "C": (100.0, 115.0, 10)})
    kiwoom = {1: ("화장품", ["A", "X"])}
    C.stock_theme_lists(rows, kiwoom, C.theme_groups(rows, kiwoom), source="kiwoom")
    kis = {7: ("반도체 장비", ["B", "C", "Y"]), 8: ("화장품(KIS)", ["A"])}
    assert C.fill_fallback_themes(rows, rows, kis) == 2
    by = {r["ticker"]: r for r in rows}
    assert [(t["name"], t["source"]) for t in by["A"]["themes"]] == [("화장품", "kiwoom")]
    assert by["B"]["themes"] == [{"id": 7, "name": "반도체 장비", "size": 3, "moved": 2, "source": "kis"}]
    assert by["C"]["primary_theme_id"] is None  # 대표 테마·묶음은 키움 기준 그대로
    assert C.fill_fallback_themes(rows, rows, {}) == 0

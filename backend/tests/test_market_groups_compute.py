"""시장 그룹 집계(순수) — 종목 등락·거래대금·시총, 테마/업종 평균·대장주·순위."""
from datetime import date, timedelta

import pytest

from apps.collector.market_groups import compute as mg

D = date(2026, 10, 16)


def _bars(closes, volume=1000):
    start = D - timedelta(days=len(closes) - 1)
    return [(start + timedelta(days=i), float(c), float(volume)) for i, c in enumerate(closes)]


def test_stock_values_periods_and_shortage():
    v = mg.stock_values(_bars([100.0] * 15 + [110.0, 120.0]), listed_shares_k=10)
    assert v["close"] == 120.0
    assert v["chg_1d"] == pytest.approx(120 / 110 * 100 - 100)
    assert v["chg_5d"] == pytest.approx(20.0)   # 5봉 전 100
    assert v["chg_20d"] is None                  # 17봉뿐
    assert v["value"] == 120.0 * 1000 and v["mcap"] == 120.0 * 10_000


def test_stock_values_single_bar_and_no_shares():
    v = mg.stock_values(_bars([50.0]), listed_shares_k=None)
    assert v["chg_1d"] is None and v["mcap"] is None and v["value"] == 50_000.0


def _sv(chg, value, mcap=1000.0):
    return {"close": 1.0, "chg_1d": chg, "chg_5d": None if chg is None else chg * 2, "chg_20d": None,
            "value": value, "mcap": mcap}


def test_aggregate_average_leader_rank_and_min_members():
    stocks = {"A": _sv(5.0, 100), "B": _sv(-1.0, 500), "C": _sv(2.0, 300), "D": _sv(0.0, 50),
              "E": _sv(9.0, 10), "F": _sv(1.0, 10), "H": _sv(30.0, 9999)}
    groups = {"1": ("반도체", ["A", "B", "C", "D", "H"]), "2": ("작은", ["E", "F"]), "3": ("빈", ["ZZ"])}
    rows = {r["group_id"]: r for r in mg.aggregate("theme", D, groups, stocks, halted={"H"})}
    assert set(rows) == {"1", "2"}                              # 구성 0 그룹은 행 없음
    t = rows["1"]
    assert t["members"] == 4                                    # 거래정지 H 제외
    assert t["chg_1d"] == pytest.approx(1.5) and t["chg_5d"] == pytest.approx(3.0) and t["chg_20d"] is None
    assert (t["up"], t["down"], t["flat"]) == (2, 1, 1)
    assert t["value"] == 950 and t["mcap"] == 4000
    assert t["leader_ticker"] == "C" and t["leader_chg"] == 2.0  # 상승 종목 중 거래대금 1위
    assert t["rank"] == 1 and rows["2"]["rank"] == 0            # 3개 미만은 순위 제외
    assert t["date"] == D and t["kind"] == "theme" and t["name"] == "반도체"


def test_aggregate_leader_fallback_and_none_rank_last():
    stocks = {"A": _sv(-1.0, 100), "B": _sv(-2.0, 900), "C": _sv(-3.0, 1),
              "X": _sv(None, 5), "Y": _sv(None, 5), "Z": _sv(None, 5)}
    rows = {r["group_id"]: r for r in mg.aggregate("sector", D, {"g": ("하락", ["A", "B", "C"]),
                                                                   "n": ("없음", ["X", "Y", "Z"])}, stocks, set())}
    assert rows["g"]["leader_ticker"] == "B"        # 상승 종목 없으면 거래대금 1위
    assert rows["n"]["chg_1d"] is None
    assert rows["g"]["rank"] == 1 and rows["n"]["rank"] == 2


def test_compute_day_skips_missing_today_and_builds_sectors():
    universe = [("A", "에이", "KOSPI"), ("B", "비", "KOSDAQ"), ("C", "씨", "KOSPI")]
    profiles = {"A": ("KOSPI", "0013", 10, False), "B": ("KOSDAQ", "0013", None, False),
                "C": ("KOSPI", "0013", 10, False)}
    old = [(D - timedelta(days=3), 10.0, 1.0), (D - timedelta(days=2), 11.0, 1.0)]  # 기준일 봉 없음
    bars = {"A": _bars([10.0, 11.0]), "B": _bars([20.0, 18.0]), "C": old}
    stock_rows, group_rows = mg.compute_day(D, universe, profiles, bars, {"7": ("테마", ["A", "B", "C"])},
                                            {"0013": "전기·전자"})
    assert [r["ticker"] for r in stock_rows] == ["A", "B"]
    assert stock_rows[0]["market"] == "KOSPI" and stock_rows[1]["market"] == "KOSDAQ"
    assert stock_rows[0]["sector_m"] == "0013" and stock_rows[0]["date"] == D
    by = {(r["kind"], r["group_id"]): r for r in group_rows}
    assert by[("sector", "0013")]["name"] == "전기·전자(코스피)" and by[("sector", "0013")]["members"] == 2
    assert by[("theme", "7")]["members"] == 2


def test_compute_day_isolates_bad_stock(monkeypatch):
    real = mg.stock_values

    def boom(bars, shares):
        if bars[-1][1] == 99.0:
            raise ValueError("bad")
        return real(bars, shares)

    monkeypatch.setattr(mg, "stock_values", boom)
    universe = [("A", "에이", "KOSPI"), ("B", "비", "KOSPI")]
    profiles = {"A": ("KOSPI", "0013", 1, False), "B": ("KOSPI", "0013", 1, False)}
    stock_rows, _ = mg.compute_day(D, universe, profiles, {"A": _bars([1.0, 99.0]), "B": _bars([1.0, 2.0])}, {}, {})
    assert [r["ticker"] for r in stock_rows] == ["B"]


# ---------------------------------------------------------------- 업종 그룹 코드·시장 표기
from shared.sector_group import sector_group_code  # noqa: E402


@pytest.mark.parametrize("sector_l, sector_m, expected", [
    ("0027", "0013", "0013"),    # 코스피 제조 → 중분류
    ("1009", "1028", "1028"),    # 코스닥 제조 → 중분류
    ("0021", "0000", "0021"),    # 코스피 금융(중분류 없음) → 대분류
    ("1012", "", "1012"),        # 중분류 빈 값 → 대분류
    ("0027", "0000", ""),        # 제조인데 중분류 없음 → 업종 없음
    ("1009", "", ""),            # 코스닥 제조인데 중분류 없음 → 업종 없음
    ("0000", "0000", ""),
    ("", "", ""),
    (" 0021 ", " 0000 ", "0021"),  # 앞뒤 공백 무시
])
def test_sector_group_code(sector_l, sector_m, expected):
    assert sector_group_code(sector_l, sector_m) == expected


def test_compute_day_no_0000_group_and_stock_sector_matches_group():
    universe = [("A", "에이", "KOSPI"), ("B", "비", "KOSPI"), ("C", "씨", "KOSPI"), ("Z", "제트", "KOSPI")]
    # repo 가 이미 그룹 코드로 바꿔 주지만, 옛 값 "0000" 이 들어와도 그룹을 만들지 않는다(방어)
    profiles = {"A": ("KOSPI", "0021", 1, False), "B": ("KOSPI", "0021", 1, False),
                "C": ("KOSPI", "0021", 1, False), "Z": ("KOSPI", "0000", 1, False)}
    bars = {t: _bars([10.0, 11.0]) for t in "ABCZ"}
    stock_rows, group_rows = mg.compute_day(D, universe, profiles, bars, {}, {"0021": "금융"})
    sectors = {r["group_id"]: r for r in group_rows if r["kind"] == "sector"}
    assert set(sectors) == {"0021"}                       # "0000" 그룹 없음
    assert sectors["0021"]["members"] == 3 and sectors["0021"]["name"] == "금융(코스피)"
    by_t = {r["ticker"]: r["sector_m"] for r in stock_rows}
    assert by_t == {"A": "0021", "B": "0021", "C": "0021", "Z": ""}   # 종목 행 = 그룹 코드, 없으면 빈 값


def test_compute_day_sector_name_has_market_and_theme_name_unchanged():
    universe = [("A", "에이", "KOSPI"), ("B", "비", "KOSDAQ")]
    profiles = {"A": ("KOSPI", "0008", 1, False), "B": ("KOSDAQ", "1026", 1, False)}
    bars = {"A": _bars([1.0, 2.0]), "B": _bars([1.0, 2.0])}
    _, group_rows = mg.compute_day(D, universe, profiles, bars, {"7": ("의류 테마", ["A", "B"])},
                                   {"0008": "섬유·의류", "1026": "섬유·의류"})
    names = {(r["kind"], r["group_id"]): r["name"] for r in group_rows}
    assert names[("sector", "0008")] == "섬유·의류(코스피)"
    assert names[("sector", "1026")] == "섬유·의류(코스닥)"
    assert names[("theme", "7")] == "의류 테마"

"""표본 점검 CLI — 표본 재현성, 외부 비교 연결(대기 주입·오류 격리), 내부 검사 연결, 보고서·종료 코드(가짜 CH·PG·KRX)."""
from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from apps.collector.verify import checks
from apps.collector.verify import spot_check as sc
from apps.collector.verify.checks import Bar
from shared.clickhouse_schema import CLICKHOUSE_DB as DB

D = date(2026, 10, 16)
TICKERS = ["000001", "000002", "000003", "000004", "000005"]
MISSING = RuntimeError("Code: 60. DB::Exception: Unknown table expression identifier "
                       "'stock_data.x' in scope SELECT ... (UNKNOWN_TABLE)")


class _CH:
    """SQL 에 들어 있는 문자열로 결과를 고른다(먼저 맞는 것). 값이 예외면 던진다. 보낸 쿼리를 기록한다."""

    def __init__(self, routes):
        self.routes, self.queries = routes, []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        for key, rows in self.routes:
            if key in sql:
                if isinstance(rows, Exception):
                    raise rows
                return SimpleNamespace(result_rows=rows)
        return SimpleNamespace(result_rows=[])


def _routes(**over):
    base = {
        "latest": (f"max(date) FROM {DB}.daily_prices", [[D]]),
        "universe": (f"DISTINCT ticker FROM {DB}.daily_prices", [[t] for t in reversed(TICKERS)]),
        "bars": (f"open, high, low, close, volume FROM {DB}.daily_prices", [
            ["000001", 100.0, 112.0, 99.0, 110.0, 2000],
            ["000002", 210.0, 215.0, 195.0, 200.0, 1000],
            ["000003", 50.0, 52.0, 49.0, 50.0, 800],
            ["000004", 30.0, 31.0, 29.0, 30.0, 300],
            ["000005", 10.0, 10.0, 10.0, 10.0, 0]]),
        "prev": (f"argMax(close, date) FROM {DB}.daily_prices",
                 [["000001", 100.0], ["000002", 250.0], ["000003", 50.0], ["000005", 10.0]]),
        "close": (f"ticker, close FROM {DB}.daily_prices",
                  [["000001", 110.0], ["000002", 200.0], ["000003", 50.0], ["000004", 30.0], ["000005", 10.0]]),
        "stocks": (f"FROM {DB}.market_stock_daily", [
            ["000001", 110.0, 10.0, "0013"],
            ["000002", 200.0, -20.0, "0013"],
            ["000003", 51.0, 0.0, "0013"],    # (a) 종가 불일치(일봉 50)
            ["000004", 30.0, 5.0, "0021"],    # (b) 직전 봉 없음인데 값이 있음
            ["000005", 10.0, 0.0, ""]]),      # 거래정지
        "groups": (f"FROM {DB}.market_group_daily", [
            ["sector", "0013", "전기·전자", 3, -10.0 / 3],
            ["sector", "0021", "의료·정밀기기", 1, 5.0],
            ["sector", "0099", "의료·정밀기기", 2, 1.0],   # 재현 없음 → drift + 이름 중복
            ["theme", "7", "반도체", 2, 0.0],              # 평균 -5.0 → 불일치
            ["theme", "8", "작은", 2, 5.0]]),              # 정지 종목 빼고 (10+0)/2 → 정상
    }
    base.update(over)
    return list(base.values())


THEMES = {"7": ("반도체", ["000001", "000002"]), "8": ("작은", ["000001", "000003", "000005"])}
KRX = {"000001": Bar(100, 111, 99, 110, 1500),   # consistent
       "000002": Bar(210, 215, 195, 200, 1000),  # exact
       "000003": Bar(50, 53, 49, 50, 700),       # violation(고가 52 < 53)
       "000005": None}                           # missing


def _fetch(ticker, d):
    assert d == D
    if ticker == "000004":
        raise RuntimeError("KRX 응답 없음")
    return KRX[ticker]


@pytest.fixture
def env(monkeypatch):
    holder = {"ch": _CH(_routes())}
    monkeypatch.setattr(sc, "_ch", lambda: holder["ch"])
    monkeypatch.setattr(sc, "_theme_groups", lambda: THEMES)
    monkeypatch.setattr(sc, "_halted", lambda: {"000005"})

    def use(**over):
        holder["ch"] = _CH(_routes(**over))
        return holder["ch"]

    return SimpleNamespace(use=use, holder=holder)


def test_sample_is_sorted_and_reproducible(env):
    a = sc.sample_tickers(D, 3, seed=42)
    assert a == sc.sample_tickers(D, 3, seed=42) == sorted(a)
    assert len(a) == 3 and set(a) <= set(TICKERS)
    assert sc.sample_tickers(D, 99, seed=1) == TICKERS  # 종목 수보다 많이 달라면 전부


def test_external_check_classifies_and_throttles(env):
    waits = []
    out = sc.external_check(D, TICKERS, fetch=_fetch, pause=waits.append, throttle=0.3)
    assert [(e["ticker"], e["status"]) for e in out] == [
        ("000001", checks.CONSISTENT), ("000002", checks.EXACT), ("000003", checks.VIOLATION),
        ("000004", checks.ERROR), ("000005", checks.MISSING)]
    assert waits == [0.3] * 4  # 종목 사이에만 쉰다
    assert "KRX 응답 없음" in out[3]["reasons"][0]
    assert out[2]["ours"] == {"open": 50.0, "high": 52.0, "low": 49.0, "close": 50.0, "volume": 800}
    assert out[2]["krx"]["high"] == 53 and out[4]["krx"] is None


def test_bar_from_krx_rows_maps_korean_columns():
    row = {"시가": 100, "고가": 110, "저가": 95, "종가": 105, "거래량": 1000, "등락률": 1.2}
    assert sc.bar_from_krx_rows([row]) == Bar(100.0, 110.0, 95.0, 105.0, 1000)
    assert sc.bar_from_krx_rows([]) is None


def test_internal_checks(env):
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 5 and out["groups_checked"] == 5
    assert [(m["check"], m["ticker"]) for m in out["stock_mismatches"]] == [("close", "000003"), ("chg_1d", "000004")]
    assert [m["group_id"] for m in out["group_mismatches"]] == ["7"]
    assert [d["group_id"] for d in out["group_drifts"]] == ["0099"]
    assert out["duplicates"] == [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0099"]}]
    assert out["notes"] == []


def test_internal_queries_use_final_and_market_groups_window(env):
    sc.internal_checks(D)
    queries = env.holder["ch"].queries
    sql, params = next(q for q in queries if "argMax(close, date)" in q[0])
    assert "FINAL" in sql and params == {"d": D, "since": D - timedelta(days=45)}
    group_sql = next(s for s, _ in queries if "market_group_daily" in s)
    assert "FINAL" in group_sql and "members > 0" in group_sql


def test_internal_theme_failure_checks_sectors_only(env, monkeypatch):
    def boom():
        raise RuntimeError("pg down")

    monkeypatch.setattr(sc, "_theme_groups", boom)
    out = sc.internal_checks(D)
    assert out["groups_checked"] == 3 and out["group_mismatches"] == []
    assert [d["group_id"] for d in out["group_drifts"]] == ["0099"]
    assert any("테마" in n for n in out["notes"])


def test_internal_halted_failure_skips_group_means(env, monkeypatch):
    def boom():
        raise RuntimeError("pg down")

    monkeypatch.setattr(sc, "_halted", boom)
    out = sc.internal_checks(D)
    assert out["groups_checked"] == 0 and out["group_mismatches"] == [] and out["group_drifts"] == []
    assert len(out["duplicates"]) == 1 and len(out["stock_mismatches"]) == 2
    assert any("거래정지" in n for n in out["notes"])


def test_internal_missing_tables_are_notes(env):
    env.use(stocks=(f"FROM {DB}.market_stock_daily", MISSING))
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 0 and "market_stock_daily" in out["notes"][0]
    env.use(groups=(f"FROM {DB}.market_group_daily", MISSING))
    out = sc.internal_checks(D)
    assert out["stocks_checked"] == 5 and out["groups_checked"] == 0
    assert any("market_group_daily" in n for n in out["notes"])


def test_main_writes_report_and_fails_on_violation(env, tmp_path, capsys):
    out = tmp_path / "r.md"
    waits = []
    code = sc.main(["--n", "5", "--seed", "7", "--out", str(out)], fetch=_fetch, pause=waits.append)
    assert code == 1 and len(waits) == 4
    text = out.read_text(encoding="utf-8")
    assert text.startswith("# 시장 데이터 표본 점검 — 2026-10-16")
    assert "seed 7" in text and "## 외부 위반" in text and "고가 52 < KRX 53" in text
    assert "## KRX 조회 오류" in text and "## 내부 불일치 — 종목" in text and "## 내부 불일치 — 그룹" in text
    assert "## 구성 변경 추정(경고)" in text and "## 이름 중복(경고)" in text and "0021, 0099" in text
    printed = capsys.readouterr().out
    assert "위반 1" in printed and str(out) in printed


def test_main_clean_run_exits_zero_with_warnings_only(env, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sc, "internal_checks", lambda d: {
        "stocks_checked": 5, "stock_mismatches": [], "groups_checked": 2, "group_mismatches": [],
        "group_drifts": [{"kind": "theme", "group_id": "8", "name": "작은", "members": 2, "expected_members": 3}],
        "duplicates": [{"kind": "sector", "name": "의료·정밀기기", "group_ids": ["0021", "0099"]}], "notes": []})
    code = sc.main(["--n", "5", "--date", "2026-10-16"],
                   fetch=lambda t, d: sc.our_bars(d, [t])[t], pause=lambda s: None)
    assert code == 0
    report = tmp_path / "spot_check_2026-10-16.md"  # 기본 경로 = 현재 디렉터리
    assert report.exists() and "seed " in report.read_text(encoding="utf-8")
    assert "seed " in capsys.readouterr().out       # seed 를 안 줘도 만들어 남긴다


def test_main_no_daily_data_exits_2(env, tmp_path):
    env.use(latest=(f"max(date) FROM {DB}.daily_prices", [[date(1970, 1, 1)]]))
    assert sc.main(["--out", str(tmp_path / "x.md")], fetch=_fetch, pause=lambda s: None) == 2
    assert not (tmp_path / "x.md").exists()


def _clean_internal(d):
    return {"stocks_checked": 5, "stock_mismatches": [], "groups_checked": 2, "group_mismatches": [],
            "group_drifts": [], "duplicates": [], "notes": []}


def _boom(ticker, d):
    raise RuntimeError("KRX 장애")


def test_main_error_majority_exits_3(env, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sc, "internal_checks", _clean_internal)
    out = tmp_path / "r.md"
    code = sc.main(["--n", "5", "--seed", "1", "--out", str(out)], fetch=_boom, pause=lambda s: None)
    assert code == 3
    msg = "pykrx·KRX 조회 실패가 표본의 절반을 넘음 — 외부 비교 결과를 믿을 수 없음"
    assert msg in out.read_text(encoding="utf-8") and msg in capsys.readouterr().out


def test_main_error_majority_does_not_mask_violation(env, tmp_path, monkeypatch):
    # 위반(1)이 있으면 error 과반이어도 1 이 우선
    monkeypatch.setattr(sc, "internal_checks", _clean_internal)

    def fetch(t, d):
        if t == "000003":
            return KRX[t]  # violation
        raise RuntimeError("x")

    assert sc.main(["--n", "5", "--seed", "1", "--out", str(tmp_path / "r.md")], fetch=fetch, pause=lambda s: None) == 1


def test_main_error_at_most_half_is_not_3(env, tmp_path, monkeypatch):
    monkeypatch.setattr(sc, "internal_checks", _clean_internal)
    # 5종목 중 오류 1(000004) → 정상 0
    assert sc.main(["--n", "5", "--seed", "1", "--out", str(tmp_path / "r.md")],
                   fetch=lambda t, d: _fetch(t, d) if t != "000003" else Bar(50, 52, 49, 50, 800), pause=lambda s: None) == 0


def test_report_header_recommends_latest_day(env, tmp_path):
    out = tmp_path / "r.md"
    sc.main(["--n", "5", "--seed", "1", "--out", str(out)], fetch=_fetch, pause=lambda s: None)
    assert "테마 일관성 점검은 최신 거래일 실행을 권장(과거 날짜는 테마 구성 변경으로 '구성 변경 추정'이 많음)" in out.read_text(encoding="utf-8")


def test_main_explicit_date_without_rows_exits_2(env, tmp_path, capsys):
    env.use(universe=(f"DISTINCT ticker FROM {DB}.daily_prices", []))
    out = tmp_path / "x.md"
    assert sc.main(["--date", "2026-10-15", "--out", str(out)], fetch=_fetch, pause=lambda s: None) == 2
    assert "그 날짜에 일봉이 없어요: 2026-10-15" in capsys.readouterr().err and not out.exists()


def test_main_internal_failure_still_writes_report_and_exits_1(env, tmp_path, monkeypatch):
    def boom(d):
        raise ValueError("ch 끊김")

    monkeypatch.setattr(sc, "internal_checks", boom)
    out = tmp_path / "r.md"
    code = sc.main(["--n", "5", "--seed", "1", "--out", str(out)],
                   fetch=lambda t, d: sc.our_bars(d, [t])[t], pause=lambda s: None)
    assert code == 1
    assert "내부 일관성 점검 실패: ValueError: ch 끊김" in out.read_text(encoding="utf-8")


def test_external_missing_our_bar_skips_fetch(env):
    env.use(bars=(f"open, high, low, close, volume FROM {DB}.daily_prices", []))
    calls = []
    out = sc.external_check(D, TICKERS[:2], fetch=lambda t, d: calls.append(t), pause=lambda s: None)
    assert calls == [] and [(e["status"], e["reasons"]) for e in out] == [(checks.MISSING, ["우리 일봉 없음"])] * 2


def test_report_escapes_pipes():
    assert sc._v("a|b") == "a\\|b"


def test_report_header_mentions_split_caveat(env, tmp_path):
    out = tmp_path / "r.md"
    sc.main(["--n", "5", "--seed", "1", "--out", str(out)], fetch=_fetch, pause=lambda s: None)
    assert "이후 액면분할 등으로 수정주가 기준이 달라져 위반처럼 보일 수 있음" in out.read_text(encoding="utf-8")

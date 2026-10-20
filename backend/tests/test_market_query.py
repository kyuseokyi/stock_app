"""시장 탭 조회 — 지수·거시 요약, 순위(기간·정렬·연속 상위), 트리맵('기타'), 그룹 상세, 일정(가짜 CH·PG)."""
from datetime import date

import pytest

from apps.stock_api.services import market_query as mq

D = date(2026, 10, 16)


class _FakeCH:
    def __init__(self, results):
        self.results, self.queries = list(results), []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        return type("R", (), {"result_rows": self.results.pop(0) if self.results else []})()


@pytest.fixture
def ch(monkeypatch):
    holder = {}

    def use(results):
        holder["ch"] = _FakeCH(results)
        monkeypatch.setattr(mq, "_ch", lambda: holder["ch"])
        return holder["ch"]

    monkeypatch.setattr(mq, "_names", lambda tickers: {t: f"이름{t}" for t in tickers if t})
    monkeypatch.setattr(mq, "_today", lambda: D)
    return use


def test_latest_date_none_when_empty_or_missing(ch, monkeypatch):
    ch([[(date(1970, 1, 1),)]])
    assert mq.latest_date() is None

    def boom():
        raise RuntimeError("no table")

    monkeypatch.setattr(mq, "_ch", boom)
    assert mq.latest_date() is None
    assert mq.groups() == {"date": None, "total": 0, "items": []}
    assert mq.treemap() == {"date": None, "groups": []}
    assert mq.group("theme", "1") is None


def test_groups_period_sort_whitelist_and_streak(ch):
    fake = ch([[(D,)], [(2,)],
               [("7", "반도체", 5, 3.2, 1e9, 4, 1, 0, "AAA", 5.0, 1), ("9", "2차전지", 3, 1.0, 5e8, 2, 1, 0, "", None, 2)],
               [(D, "7", 1), (date(2026, 10, 15), "7", 3), (date(2026, 10, 14), "7", 12),
                (D, "9", 2), (date(2026, 10, 15), "9", 11)]])
    out = mq.groups(kind="theme", period="5d", sort="chg", limit=999, offset=0)
    assert out["date"] == "2026-10-16" and out["total"] == 2
    a, b = out["items"]
    assert a == {"id": "7", "name": "반도체", "members": 5, "chg": 3.2, "value": 1e9, "up": 4, "down": 1, "flat": 0,
                 "leader": {"ticker": "AAA", "name": "이름AAA", "chg": 5.0}, "rank": 1, "streak": 2}
    assert b["leader"] is None and b["streak"] == 1
    sql, params = fake.queries[2]
    assert "chg_5d DESC NULLS LAST" in sql and "rank > 0" in sql and params["limit"] == 100


def test_groups_bad_inputs_fall_back(ch):
    fake = ch([[(D,)], [(0,)], []])
    mq.groups(kind="x; DROP", period="99d", sort="value")
    sql, params = fake.queries[2]
    assert "DROP" not in sql and params["kind"] == "theme" and "ORDER BY value DESC" in sql
    assert "chg_1d" in sql


def test_sector_groups_include_small_groups(ch):
    fake = ch([[(D,)], [(0,)], []])
    mq.groups(kind="sector")
    assert "rank > 0" not in fake.queries[1][0]


def test_treemap_sector_with_etc_tile(ch, monkeypatch):
    monkeypatch.setattr(mq, "TREEMAP_STOCKS", 2)
    ch([[(D,)], [("0013", "전기·전자", 1.5), ("0099", "빈 업종", 0.0)],
        [("A", "0013", 2.0, 300.0), ("B", "0013", -1.0, 200.0), ("C", "0013", 4.0, 50.0), ("E", "0013", None, 50.0)]])
    out = mq.treemap(kind="sector", size="mcap")
    assert out["date"] == "2026-10-16" and [g["id"] for g in out["groups"]] == ["0013"]  # 크기 0 업종은 빠짐
    g = out["groups"][0]
    assert g["size"] == 600.0
    assert [s["ticker"] for s in g["stocks"]] == ["A", "B", ""]
    assert g["stocks"][2] == {"ticker": "", "name": "기타 2종목", "chg": 4.0, "size": 100.0}


def test_treemap_theme_uses_membership_and_limit(ch, monkeypatch):
    monkeypatch.setattr(mq, "_theme_groups", lambda: {"7": ("반도체", ["A", "B"])})
    fake = ch([[(D,)], [("7", "반도체", 2.0)], [("A", 1.0, 10.0), ("B", 3.0, 30.0)]])
    out = mq.treemap(kind="theme", size="value", period="20d")
    assert [s["ticker"] for s in out["groups"][0]["stocks"]] == ["B", "A"]
    assert "LIMIT 30" in fake.queries[1][0] and "chg_20d" in fake.queries[1][0]
    assert "value" in fake.queries[2][0] and fake.queries[2][1]["t"] == ("A", "B")


def _group_row(**kw):
    base = {"group_id": "0013", "name": "전기·전자", "members": 3, "chg_1d": 1.0, "chg_5d": 2.0, "chg_20d": None,
            "value": 1e9, "mcap": 1e12, "up": 2, "down": 1, "flat": 0, "leader_ticker": "B", "leader_chg": 3.0,
            "rank": 4}
    base.update(kw)
    return tuple(base[c] for c in mq._GROUP_COLUMNS)


def test_group_sector_detail(ch):
    ch([[(D,)], [_group_row()], [(D, 1.0, 4), (date(2026, 10, 15), 0.5, 7)],
        [("A", 100.0, -1.0, 0.0, 10.0, 1e3), ("B", 200.0, 3.0, 5.0, 90.0, None)]])
    out = mq.group("sector", "0013")
    assert out["name"] == "전기·전자" and out["rank"] == 4 and out["description"] is None
    assert out["history"] == [{"date": "2026-10-15", "chg1d": 0.5, "rank": 7}, {"date": "2026-10-16", "chg1d": 1.0, "rank": 4}]
    assert [s["ticker"] for s in out["stocks"]] == ["B", "A"]  # 거래대금 순
    assert out["stocks"][0]["is_leader"] is True and out["stocks"][0]["name"] == "이름B"


def test_group_theme_detail_reasons(ch, monkeypatch):
    monkeypatch.setattr(mq, "_theme_info", lambda gid: ("메모리 관련", {"A": "HBM"}))
    monkeypatch.setattr(mq, "_theme_groups", lambda: {"7": ("반도체", ["A"])})
    ch([[(D,)], [_group_row(group_id="7", name="반도체", leader_ticker="A")], [],
        [("A", 100.0, 1.0, 2.0, 10.0, 1e3)]])
    out = mq.group("theme", "7")
    assert out["description"] == "메모리 관련" and out["stocks"][0]["reason"] == "HBM"


def test_group_missing_or_bad_kind(ch):
    ch([[(D,)], []])
    assert mq.group("theme", "404") is None
    assert mq.group("bogus", "1") is None


def test_overview_indices_and_macro_yoy(ch):
    idx = [("KR:0001", date(2026, 10, 15), 2500.0), ("KR:0001", D, 2550.0), ("US:SPX", date(2026, 10, 15), 6000.0)]
    macro = [("CPIAUCSL", date(2025, 8, 1), 300.0), ("CPIAUCSL", date(2025, 9, 1), 301.0),
             ("CPIAUCSL", date(2026, 8, 1), 309.0), ("CPIAUCSL", date(2026, 9, 1), 310.03),
             ("UNRATE", date(2026, 8, 1), 4.1), ("UNRATE", date(2026, 9, 1), 4.2),
             ("CPILFESL", date(2026, 9, 1), 320.0)]  # 1년 전 값 없음 → 숨김
    ch([idx, macro])
    out = mq.overview()
    kospi, spx = out["indices"]
    assert kospi["code"] == "KR:0001" and kospi["region"] == "KR" and kospi["chg1d"] == pytest.approx(2.0)
    assert kospi["spark"] == [2500.0, 2550.0] and kospi["date"] == "2026-10-16"
    assert spx["region"] == "US" and spx["chg1d"] is None
    by = {m["series_id"]: m for m in out["macro"]}
    assert set(by) == {"CPIAUCSL", "UNRATE"}
    assert by["CPIAUCSL"]["value"] == pytest.approx(3.0) and by["CPIAUCSL"]["prev"] == pytest.approx(3.0)
    assert by["UNRATE"] == {"series_id": "UNRATE", "name": "실업률", "unit": "%", "date": "2026-09-01",
                            "value": 4.2, "prev": 4.1}


def test_overview_tables_missing(monkeypatch):
    def boom():
        raise RuntimeError("no table")

    monkeypatch.setattr(mq, "_ch", boom)
    assert mq.overview() == {"indices": [], "macro": []}


def test_calendar_range_category_and_detail(monkeypatch):
    seen = {}

    def events(start, end, category):
        seen.update(start=start, end=end, category=category)
        return [(date(2026, 10, 20), "에이 청약", "공모주", "AAA", {"fix_subscr_pri": "25000", "lead_mgr": "한국투자증권"}),
                (date(2026, 10, 21), "비 상장", "공모주", "BBB", {"fix_subscr_pri": "", "lead_mgr": ""}),
                (date(2026, 11, 12), "미국 CPI 발표", "경제지표", None, {})]

    monkeypatch.setattr(mq, "_events", events)
    monkeypatch.setattr(mq, "_names", lambda tickers: {"AAA": "에이"})
    monkeypatch.setattr(mq, "_today", lambda: D)
    out = mq.calendar("2026-10-16", "2027-06-01", "공모주")
    assert seen == {"start": D, "end": date(2027, 1, 16), "category": "공모주"}  # 92일로 자름
    assert out[0] == {"date": "2026-10-20", "title": "에이 청약", "category": "공모주", "ticker": "AAA", "name": "에이",
                      "detail": "공모가 25,000원 · 주관 한국투자증권"}
    assert out[1]["detail"] == "" and out[2]["detail"] == "발표 예정" and out[2]["name"] is None
    mq.calendar("bad", None, "해킹")
    assert seen == {"start": D, "end": date(2026, 12, 15), "category": None}


def test_graphql_wiring(monkeypatch):
    from apps.stock_api.graphql.schema import schema

    monkeypatch.setattr(mq, "overview", lambda: {
        "indices": [{"code": "KR:0001", "name": "KOSPI", "region": "KR", "date": "2026-10-16", "close": 2550.0,
                     "chg1d": 2.0, "spark": [2500.0, 2550.0]}],
        "macro": [{"series_id": "UNRATE", "name": "실업률", "unit": "%", "date": "2026-09-01", "value": 4.2,
                   "prev": 4.1}]})
    monkeypatch.setattr(mq, "groups", lambda **kw: {"date": "2026-10-16", "total": 1, "items": [
        {"id": "7", "name": "반도체", "members": 5, "chg": 3.2, "value": 1e9, "up": 4, "down": 1, "flat": 0,
         "leader": None, "rank": 1, "streak": 2}]})
    monkeypatch.setattr(mq, "treemap", lambda **kw: {"date": "2026-10-16", "groups": [
        {"id": "0013", "name": "전기·전자", "chg": 1.0, "size": 9.0,
         "stocks": [{"ticker": "", "name": "기타 2종목", "chg": None, "size": 9.0}]}]})
    monkeypatch.setattr(mq, "group", lambda kind, gid: None)
    monkeypatch.setattr(mq, "calendar", lambda s, e, c: [
        {"date": "2026-10-20", "title": "에이 청약", "category": "공모주", "ticker": "AAA", "name": "에이",
         "detail": "공모가 25,000원"}])
    res = schema.execute_sync("""{ marketOverview { indices { code chg1d spark } macro { seriesId unit } }
      marketGroups(kind: "theme") { total items { id leader { ticker } streak } }
      marketTreemap { groups { id stocks { ticker name } } }
      marketGroup(kind: "theme", id: "404") { id }
      marketCalendar(start: "2026-10-16", end: "2026-12-15") { date detail } }""")
    assert res.errors is None, res.errors
    assert res.data["marketOverview"]["macro"] == [{"seriesId": "UNRATE", "unit": "%"}]
    assert res.data["marketGroups"]["items"][0] == {"id": "7", "leader": None, "streak": 2}
    assert res.data["marketTreemap"]["groups"][0]["stocks"][0]["name"] == "기타 2종목"
    assert res.data["marketGroup"] is None
    assert res.data["marketCalendar"] == [{"date": "2026-10-20", "detail": "공모가 25,000원"}]


def test_web_queries_match_schema(monkeypatch):
    """web_client/src/api/market.ts 의 쿼리 문자열을 그대로 꺼내 실제 스키마로 실행(웹↔API 계약)."""
    import pathlib
    import re

    from apps.stock_api.graphql.schema import schema

    ts = (pathlib.Path(__file__).resolve().parents[2] / "web_client/src/api/market.ts").read_text(encoding="utf-8")
    queries = dict(re.findall(r"export const (\w+_QUERY) = `([^`]+)`", ts))
    assert set(queries) == {"OVERVIEW_QUERY", "GROUPS_QUERY", "TREEMAP_QUERY", "GROUP_QUERY", "CALENDAR_QUERY"}

    seen = {}
    monkeypatch.setattr(mq, "overview", lambda: {"indices": [], "macro": []})
    monkeypatch.setattr(mq, "groups", lambda **kw: seen.setdefault("groups", kw) and {
        "date": "2026-10-16", "total": 1, "items": [
            {"id": "7", "name": "반도체", "members": 5, "chg": 3.2, "value": 1e9, "up": 4, "down": 1, "flat": 0,
             "leader": {"ticker": "AAA", "name": "에이", "chg": 5.0}, "rank": 1, "streak": 2}]})
    monkeypatch.setattr(mq, "treemap", lambda **kw: seen.setdefault("treemap", kw) and {"date": None, "groups": []})
    monkeypatch.setattr(mq, "group", lambda kind, gid: {
        "kind": kind, "id": gid, "name": "반도체", "description": None, "date": "2026-10-16", "chg1d": 1.0,
        "chg5d": None, "chg20d": None, "value": 1.0, "mcap": 1.0, "up": 1, "down": 0, "flat": 0, "rank": 1,
        "history": [{"date": "2026-10-16", "chg1d": 1.0, "rank": 1}],
        "stocks": [{"ticker": "AAA", "name": "에이", "close": 1.0, "chg1d": 1.0, "chg5d": None, "value": 1.0,
                    "mcap": None, "is_leader": True, "reason": None}]})
    monkeypatch.setattr(mq, "calendar", lambda s, e, c: seen.setdefault("calendar", (s, e, c)) and [])

    variables = {
        "OVERVIEW_QUERY": {},
        "GROUPS_QUERY": {"kind": "theme", "period": "5d", "sort": "value", "limit": 30, "offset": 0},
        "TREEMAP_QUERY": {"kind": "sector", "size": "mcap", "period": "1d"},
        "GROUP_QUERY": {"kind": "theme", "id": "7"},
        "CALENDAR_QUERY": {"start": "2026-10-16", "end": "2026-12-15", "category": None},
    }
    for name, query in queries.items():
        res = schema.execute_sync(query, variable_values=variables[name])
        assert res.errors is None, (name, res.errors)
    assert seen["groups"] == {"kind": "theme", "period": "5d", "sort": "value", "limit": 30, "offset": 0}
    assert seen["treemap"] == {"kind": "sector", "size": "mcap", "period": "1d"}
    assert seen["calendar"] == ("2026-10-16", "2026-12-15", None)


def test_calendar_ipo_name_falls_back_to_payload(monkeypatch):
    monkeypatch.setattr(mq, "_events", lambda s, e, c: [
        (date(2026, 10, 20), "123450 공모주 청약", "공모주", "123450", {"isin_name": "신규기업"}),
        (date(2026, 10, 21), "999990 공모주 청약", "공모주", "999990", {})])
    monkeypatch.setattr(mq, "_names", lambda tickers: {})
    monkeypatch.setattr(mq, "_today", lambda: D)
    out = mq.calendar(None, None, "공모주")
    assert [o["name"] for o in out] == ["신규기업", None]


def test_calendar_old_ticker_title_gets_name(monkeypatch):
    # 이름 없이 저장된 예전 제목도 종목명으로 보여 준다
    monkeypatch.setattr(mq, "_events", lambda s, e, c: [
        (date(2026, 10, 20), "123450 공모주 청약", "공모주", "123450", {"isin_name": "신규기업"}),
        (date(2026, 10, 21), "999990 신규 상장", "공모주", "999990", {})])
    monkeypatch.setattr(mq, "_names", lambda tickers: {})
    monkeypatch.setattr(mq, "_today", lambda: D)
    assert [o["title"] for o in mq.calendar(None, None, "공모주")] == ["신규기업 공모주 청약", "999990 신규 상장"]

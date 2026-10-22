"""차트 패턴 조회 — 리포트별 WHERE, 화이트리스트, 정렬, 페이징, 준비 중, 테이블 없음, zones 경계, points 파싱(가짜 CH·PG)."""
import json
from datetime import date

import pytest
from clickhouse_connect.driver.exceptions import DatabaseError, OperationalError

from apps.stock_api.services import pattern_query as pq

D = date(2026, 10, 16)


class _FakeCH:
    """SQL 조각으로 응답을 고른다(순서 무관). handlers: [(조각, 행 목록)] — 먼저 맞는 것."""

    def __init__(self, handlers):
        self.handlers, self.queries = handlers, []

    def query(self, sql, parameters=None):
        self.queries.append((sql, parameters or {}))
        for frag, rows in self.handlers:
            if frag in sql:
                return type("R", (), {"result_rows": rows})()
        return type("R", (), {"result_rows": []})()

    def sqls(self, frag):
        return [(s, p) for s, p in self.queries if frag in s]


@pytest.fixture
def ch(monkeypatch):
    def use(*handlers):
        fake = _FakeCH([("max(date)", [(D,)]), *handlers])
        monkeypatch.setattr(pq, "_ch", lambda: fake)
        return fake

    monkeypatch.setattr(pq, "_names", lambda tickers: {"AAA": "에이"})
    monkeypatch.setattr(pq, "_sector_names", lambda codes: {"0013": "전기·전자"})
    return use


SCREEN_ROW = ("AAA", "KOSPI", 98.0, "cup", "1", 1, 100.0, 20.0, 40, 1, None, None, None, None)


def test_no_data_yet(ch, monkeypatch):
    monkeypatch.setattr(pq, "_ch", lambda: _FakeCH([("max(date)", [(date(1970, 1, 1),)])]))
    assert pq.screen() == {"date": None, "total": 0, "items": []}
    assert pq.bases("AAA") == {"date": None, "ticker": "AAA", "name": "AAA", "close": None, "bases": [], "zones": None}

    class Boom:
        def query(self, sql, parameters=None):
            raise DatabaseError("Code: 60. (UNKNOWN_TABLE)", code=60, name="UNKNOWN_TABLE")

    monkeypatch.setattr(pq, "_ch", lambda: Boom())
    assert pq.screen() == {"date": None, "total": 0, "items": []}


def test_latest_date_other_errors_raise(monkeypatch, caplog):
    for exc in (OperationalError("Error executing HTTP request"), TimeoutError("timeout"),
                DatabaseError("Code: 241 memory", code=241, name="MEMORY_LIMIT_EXCEEDED")):
        def boom(sql, params=None, _e=exc):
            raise _e

        monkeypatch.setattr(pq, "_query", boom)
        with pytest.raises(type(exc)):
            pq.latest_date()
    assert "최신 기준일 조회 실패" in caplog.text


@pytest.mark.parametrize("report, cond", [
    ("breakout_today", "days_since_breakout = 1"),
    ("recent_breakouts", "days_since_breakout BETWEEN 1 AND 20"),
    ("near_pivot", "is_active = 1 AND close > pivot * 0.90 AND close < pivot * 1.05"),
    ("forming", "is_active = 1"),
    ("nonsense", "is_active = 1"),  # 모르는 값은 forming
])
def test_report_where(ch, report, cond):
    fake = ch(("count()", [(0,)]))
    pq.screen(report=report)
    for frag in ("count()", "ORDER BY"):
        sql, params = fake.sqls(frag)[0]
        assert "date = %(d)s AND is_current = 1 AND " + cond in sql and params["d"] == D
        assert "FINAL" in sql


def test_filters_whitelist(ch):
    fake = ch(("count()", [(0,)]))
    pq.screen(pattern_type="htf", market="KOSDAQ")
    sql, params = fake.sqls("count()")[0]
    assert "pattern_type = %(pattern_type)s" in sql and "market = %(market)s" in sql
    assert params["pattern_type"] == "htf" and params["market"] == "KOSDAQ"

    fake = ch(("count()", [(0,)]))
    pq.screen(pattern_type="cup'; DROP TABLE x;--", market="NASDAQ", sort="1; DROP", report="x' OR '1")
    sql, params = fake.sqls("ORDER BY")[0]
    assert "pattern_type =" not in sql and "market =" not in sql and "DROP" not in sql and "OR '1" not in sql
    assert "pattern_type" not in params and "market" not in params
    assert "ORDER BY abs(close / pivot - 1) ASC, ticker" in sql


@pytest.mark.parametrize("sort, order", [
    ("pivot_dist", "abs(close / pivot - 1) ASC, ticker"),
    ("breakout_vol", "breakout_vol_pct DESC NULLS LAST, ticker"),
    ("depth", "depth ASC, ticker"),
    ("length", "length DESC, ticker"),
])
def test_sorts(ch, sort, order):
    fake = ch(("count()", [(0,)]))
    pq.screen(sort=sort)
    assert f"ORDER BY {order} LIMIT" in fake.sqls("ORDER BY")[0][0]


def test_paging_and_max_limit(ch):
    fake = ch(("count()", [(0,)]))
    pq.screen(limit=100000, offset=-5)
    assert fake.sqls("ORDER BY")[0][1]["limit"] == pq.MAX_LIMIT == 200
    assert fake.sqls("ORDER BY")[0][1]["offset"] == 0
    fake = ch(("count()", [(0,)]))
    pq.screen(limit=0, offset=30)
    p = fake.sqls("ORDER BY")[0][1]
    assert p["limit"] == 1 and p["offset"] == 30
    assert "LIMIT %(limit)s OFFSET %(offset)s" in fake.sqls("ORDER BY")[0][0]


def test_items_shape(ch):
    row = ("AAA", "KOSPI", 105.0, "cup", "2", 2, 100.0, 20.0, 40, 0, date(2026, 10, 14), 4.5, 130.0, 3)
    ch(("count()", [(7,)]), ("ORDER BY", [row]), ("screener_daily", [("AAA", "0013")]))
    out = pq.screen()
    assert out["date"] == "2026-10-16" and out["total"] == 7
    it = out["items"][0]
    assert it == {
        "ticker": "AAA", "name": "에이", "market": "KOSPI", "sector_name": "전기·전자", "close": 105.0,
        "pattern_type": "cup", "label": "2", "stage": 2, "pivot": 100.0, "pivot_dist_pct": pytest.approx(5.0),
        "depth": 20.0, "length": 40, "is_active": False, "breakout_date": "2026-10-14",
        "breakout_price_pct": 4.5, "breakout_vol_pct": 130.0, "days_since_breakout": 3,
    }


def test_item_without_name_or_sector(ch, monkeypatch):
    monkeypatch.setattr(pq, "_names", lambda tickers: {})
    ch(("count()", [(1,)]), ("ORDER BY", [SCREEN_ROW]))
    it = pq.screen()["items"][0]
    assert it["name"] == "AAA" and it["sector_name"] is None and it["breakout_date"] is None
    assert it["pivot_dist_pct"] == pytest.approx(-2.0)


# ---------------------------------------------------------------- bases / zones
def _base_row(pivot=100.0, current=True, bo=None, points=None, rim=date(2026, 8, 3)):
    pts = json.dumps(points if points is not None else [{"role": "rim", "date": "2026-08-03", "price": 101.0}])
    return ("cup", "1", 1, 0, 1, rim, date(2026, 9, 1), 80.0, pivot, 20.0, 40, 0 if bo else 1, 1 if current else 0,
            bo, 4.0 if bo else None, 120.0 if bo else None, 3 if bo else None, 55.0, 0.8, pts, 104.0)


BO = date(2026, 10, 13)


def _bases(ch, rows, extremes=None):
    handlers = [("chart_pattern_daily FINAL WHERE", rows)]
    if extremes is not None:
        handlers.append(("daily_prices", [extremes]))
    fake = ch(*handlers)
    return pq.bases("AAA"), fake


def test_bases_forming_zones_and_points(ch):
    out, fake = _bases(ch, [_base_row(current=False, rim=date(2026, 3, 2)), _base_row()])
    assert out["date"] == "2026-10-16" and out["ticker"] == "AAA" and out["name"] == "에이" and out["close"] == 104.0
    assert [b["rim_date"] for b in out["bases"]] == ["2026-03-02", "2026-08-03"]
    b = out["bases"][1]
    assert b["points"] == [{"role": "rim", "date": "2026-08-03", "price": 101.0}]
    assert b["stage"] == 1 and b["is_current"] is True and b["is_active"] is True and b["prior_uptrend_pct"] == 55.0
    assert out["zones"] == {"buy_low": 100.0, "buy_high": pytest.approx(105.0), "stop_low": pytest.approx(92.0),
                            "stop_high": pytest.approx(95.0)}
    assert not fake.sqls("daily_prices")  # 돌파 전이면 일봉 조회 없음
    sql, params = fake.sqls("chart_pattern_daily FINAL WHERE")[0]
    assert "ORDER BY rim_date" in sql and params == {"d": D, "t": "AAA"}


@pytest.mark.parametrize("hi, lo, shown", [
    (145.0, 80.0, True),     # 경계: 같으면 표시
    (145.01, 90.0, False),   # 고가 > 피벗×1.45
    (120.0, 79.99, False),   # 저가 < 피벗×0.80
    (120.0, 85.0, True),
    (None, None, True),      # 일봉 없음
])
def test_zones_hide_boundaries(ch, hi, lo, shown):
    out, fake = _bases(ch, [_base_row(bo=BO)], extremes=(hi, lo))
    assert (out["zones"] is not None) is shown
    sql, params = fake.sqls("daily_prices")[0]
    assert "FINAL" in sql and params == {"t": "AAA", "bo": BO, "d": D}
    if shown:
        assert out["zones"]["buy_high"] == pytest.approx(105.0)


def test_no_current_base_no_zones(ch):
    out, _ = _bases(ch, [_base_row(current=False)])
    assert out["bases"] and out["zones"] is None


def test_unknown_ticker(ch):
    out, _ = _bases(ch, [])
    assert out == {"date": "2026-10-16", "ticker": "AAA", "name": "AAA", "close": None, "bases": [], "zones": None}


def test_points_parsing():
    assert pq._points('[{"role":"rim","date":"2026-01-02","price":1.5},{"role":"base"}]') == [
        {"role": "rim", "date": "2026-01-02", "price": 1.5}, {"role": "base", "date": None, "price": None}]
    assert pq._points("not json") == [] and pq._points("") == [] and pq._points(None) == []
    assert pq._points('[1, "x", {"role": "end", "date": "d", "price": 2}]') == [
        {"role": "end", "date": "d", "price": 2}]

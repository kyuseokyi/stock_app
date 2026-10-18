"""FRED — 관측값·발표 예정일 파싱, 키, 시리즈 목록(가짜 HTTP 세션)."""
from datetime import date

from apps.collector import fred


class _Resp:
    def __init__(self, data):
        self._d = data

    def raise_for_status(self):
        pass

    def json(self):
        return self._d


class _Session:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        return _Resp(self.routes[url.rsplit("/fred/", 1)[1]])


def test_series_list(monkeypatch):
    monkeypatch.delenv("MACRO_SERIES_EXTRA", raising=False)
    assert "CPIAUCSL" in fred.series_ids() and "DGS10" in fred.series_ids()
    monkeypatch.setenv("MACRO_SERIES_EXTRA", "gdp, CPIAUCSL")
    ids = fred.series_ids()
    assert ids.count("CPIAUCSL") == 1 and ids[-1] == "GDP"


def test_observations_parse_missing_dot():
    s = _Session({"series/observations": {"observations": [
        {"date": "2026-08-01", "value": "320.5"}, {"date": "2026-09-01", "value": "."}]}})
    c = fred.FredClient("k", session=s)
    assert c.observations("CPIAUCSL", date(2024, 10, 1)) == [(date(2026, 8, 1), 320.5), (date(2026, 9, 1), None)]
    url, params = s.calls[0]
    assert url == "https://api.stlouisfed.org/fred/series/observations"
    assert params["series_id"] == "CPIAUCSL" and params["api_key"] == "k" and params["file_type"] == "json"
    assert params["observation_start"] == "2024-10-01"


def test_release_and_dates():
    s = _Session({
        "series/release": {"releases": [{"id": 10, "name": "Consumer Price Index"}]},
        "release/dates": {"release_dates": [{"release_id": 10, "date": "2026-12-10"},
                                            {"release_id": 10, "date": "2026-11-12"},
                                            {"release_id": 10, "date": "2027-03-01"}]},
    })
    c = fred.FredClient("k", session=s)
    assert c.release_of("CPIAUCSL") == (10, "Consumer Price Index")
    assert c.release_dates(10, date(2026, 10, 18), date(2026, 12, 17)) == [date(2026, 11, 12), date(2026, 12, 10)]
    assert s.calls[1][1]["include_release_dates_with_no_data"] == "true"


def test_release_of_none_when_empty():
    c = fred.FredClient("k", session=_Session({"series/release": {"releases": []}}))
    assert c.release_of("XYZ") is None


def test_events_from_releases_uses_korean_label():
    evs = fred.release_events({10: ("Consumer Price Index", "CPIAUCSL"), 99: ("Other", "ZZZ")},
                              {10: [date(2026, 11, 12)], 99: [date(2026, 11, 20)]})
    assert evs[0] == {"event_date": date(2026, 11, 12), "title": "미국 CPI 발표", "category": "경제지표",
                      "ticker": None, "source": "fred", "source_key": "fred:10:2026-11-12",
                      "payload": {"release_id": 10, "release_name": "Consumer Price Index", "series_id": "CPIAUCSL"}}
    assert evs[1]["title"] == "Other 발표"  # 라벨 없는 시리즈는 FRED 발표명


def test_api_key_from_env(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    assert fred.api_key() is None
    monkeypatch.setenv("FRED_API_KEY", "  abc ")
    assert fred.api_key() == "abc"

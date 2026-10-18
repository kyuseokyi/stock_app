"""지수 목록 설정·수집(첫 실행 2년 백필, 이후 10일 겹침, 지표별 실패 격리)."""
from datetime import date

from apps.collector import market_indices as mi


def test_default_specs_and_extra(monkeypatch):
    monkeypatch.delenv("MARKET_INDEX_EXTRA", raising=False)
    codes = [s.code for s in mi.index_specs()]
    for c in ("KR:0001", "KR:1001", "KR:2001", "US:SPX", "US:COMP", "US:NDX", "US:SOX", "US:VIX", "US:DJI",
              "FX:USDKRW", "USSTK:NVDA", "USSTK:MU", "USSTK:AAPL", "USSTK:MSFT", "USSTK:TSLA"):
        assert c in codes
    assert len(codes) == len(set(codes))
    monkeypatch.setenv("MARKET_INDEX_EXTRA", "amd, USSTK:AVGO, NVDA")
    extra = [s for s in mi.index_specs() if s.code in ("USSTK:AMD", "USSTK:AVGO")]
    assert [(s.mrkt, s.symbol, s.region) for s in extra] == [("N", "AMD", "US"), ("N", "AVGO", "US")]
    assert [s.code for s in mi.index_specs()].count("USSTK:NVDA") == 1
    assert {s.region for s in mi.index_specs("KR")} == {"KR"}
    assert "KR:0001" not in [s.code for s in mi.index_specs("US")]


def test_chunks_cover_range():
    chunks = mi._chunks(date(2026, 1, 1), date(2026, 7, 1), 100)
    assert chunks[0][0] == date(2026, 1, 1) and chunks[-1][1] == date(2026, 7, 1)
    assert all((b - a).days < 100 for a, b in chunks)
    assert all((chunks[i + 1][0] - chunks[i][1]).days == 1 for i in range(len(chunks) - 1))


class _Client:
    def __init__(self, fail=()):
        self.calls, self.fail = [], set(fail)

    def get_domestic_index_daily(self, code, s, e):
        self.calls.append(("KR", code, s, e))
        return [{"stck_bsop_date": e, "bstp_nmix_oprc": "1", "bstp_nmix_hgpr": "1", "bstp_nmix_lwpr": "1",
                 "bstp_nmix_prpr": "1", "acml_vol": "1"}]

    def get_overseas_daily(self, mrkt, symbol, s, e):
        if symbol in self.fail:
            raise RuntimeError("rt_cd=1")
        self.calls.append(("OV", symbol, s, e))
        return [{"stck_bsop_date": e, "ovrs_nmix_oprc": "1", "ovrs_nmix_hgpr": "1", "ovrs_nmix_lwpr": "1",
                 "ovrs_nmix_prpr": "1", "acml_vol": ""}]


def test_collect_backfills_first_then_overlaps(monkeypatch):
    stored = {}
    latest = {"KR:0001": date(2026, 10, 10)}
    monkeypatch.setattr(mi.chm, "latest_index_date", lambda code: latest.get(code))

    def _upsert(code, rows):
        stored.setdefault(code, []).extend(rows)
        return len(rows)

    monkeypatch.setattr(mi.chm, "upsert_index_daily", _upsert)
    specs = [mi.IndexSpec("KR:0001", "KOSPI", "KR", "U", "0001", "KR"),
             mi.IndexSpec("KR:1001", "KOSDAQ", "KR", "U", "1001", "KR")]
    client = _Client()
    out = mi.collect_indices(specs, client, today=date(2026, 10, 18))
    kospi = [c for c in client.calls if c[1] == "0001"]
    kosdaq = [c for c in client.calls if c[1] == "1001"]
    assert kospi == [("KR", "0001", "20260930", "20261018")]   # 최근 10일 겹침
    assert kosdaq[0][2] == "20241018" and len(kosdaq) == 13      # 첫 실행 2년(60일 청크)
    assert out == {"ok": ["KR:0001", "KR:1001"], "failed": [], "inserted": 14}
    assert [r["date"] for r in stored["KR:1001"]] == sorted(r["date"] for r in stored["KR:1001"])


def test_collect_isolates_failures(monkeypatch):
    monkeypatch.setattr(mi.chm, "latest_index_date", lambda code: date(2026, 10, 15))
    monkeypatch.setattr(mi.chm, "upsert_index_daily", lambda code, rows: len(rows))
    specs = [mi.IndexSpec("US:DJI", "다우", "OVERSEAS", "N", ".DJI", "US"),
             mi.IndexSpec("US:SOX", "반도체", "OVERSEAS", "N", "SOX", "US")]
    out = mi.collect_indices(specs, _Client(fail={".DJI"}), today=date(2026, 10, 18))
    assert out["ok"] == ["US:SOX"] and out["failed"][0]["code"] == "US:DJI"

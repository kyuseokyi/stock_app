"""ECOS(한국은행) 원/달러 — 파싱(쉼표·빈 값·오류 코드), 키 없음 skipped, 키가 로그·결과에 남지 않음,
겹침 재수집 멱등(같은 series_id·date), prod_readonly 동작. 실제 ECOS 는 부르지 않는다(가짜 세션)."""
import logging
from datetime import date

import pytest
import requests

from apps.collector import ecos
from apps.collector import celery_app as ca
from apps.collector.repositories import clickhouse_market as chm
from apps.collector.tasks import market_data as md

KEY = "SECRETKEY123"


class _Resp:
    def __init__(self, data, status=200):
        self._d, self.status_code = data, status

    def json(self):
        if isinstance(self._d, Exception):
            raise self._d
        return self._d


class _Session:
    def __init__(self, resp=None, exc=None):
        self.resp, self.exc, self.urls = resp, exc, []

    def get(self, url, timeout=None):
        self.urls.append(url)
        if self.exc is not None:
            raise self.exc
        return self.resp


def _ok(rows):
    return {"StatisticSearch": {"list_total_count": len(rows), "row": rows}}


# ---------------------------------------------------------------- 파싱
def test_parse_commas_blank_and_order():
    data = _ok([
        {"TIME": "20261119", "DATA_VALUE": "1,385.2"},
        {"TIME": "20261118", "DATA_VALUE": "1384.5"},
        {"TIME": "20261117", "DATA_VALUE": ""},
        {"TIME": "20261116", "DATA_VALUE": "-"},
        {"TIME": "bad", "DATA_VALUE": "1"},
    ])
    assert ecos.parse_rows(data) == [(date(2026, 11, 16), None), (date(2026, 11, 17), None),
                                     (date(2026, 11, 18), 1384.5), (date(2026, 11, 19), 1385.2)]


def test_parse_no_data_code_is_empty():
    assert ecos.parse_rows({"RESULT": {"CODE": "INFO-200", "MESSAGE": "해당하는 데이터가 없습니다."}}) == []


def test_parse_other_error_code_raises_without_key():
    with pytest.raises(ecos.EcosError) as ei:
        ecos.parse_rows({"RESULT": {"CODE": "INFO-100", "MESSAGE": "인증키가 유효하지 않습니다."}})
    assert "INFO-100" in str(ei.value)


def test_client_url_shape():
    s = _Session(_Resp(_ok([{"TIME": "20261119", "DATA_VALUE": "1,385.2"}])))
    out = ecos.EcosClient("k", session=s).usdkrw_daily(date(2026, 11, 1), date(2026, 11, 19))
    assert out == [(date(2026, 11, 19), 1385.2)]
    assert s.urls == ["https://ecos.bok.or.kr/api/StatisticSearch/k/json/kr/1/19/731Y001/D/20261101/20261119/0000001"]


def test_client_errors_hide_key():
    url = f"https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json/kr/1/19/731Y001/D/20261101/20261119/0000001"
    cases = [
        _Session(exc=requests.ConnectionError(f"HTTPSConnectionPool: Max retries exceeded with url: {url}")),
        _Session(_Resp({}, status=500)),
        _Session(_Resp(ValueError(f"bad json {url}"))),
    ]
    for s in cases:
        with pytest.raises(ecos.EcosError) as ei:
            ecos.EcosClient(KEY, session=s).usdkrw_daily(date(2026, 11, 1), date(2026, 11, 19))
        assert KEY not in str(ei.value)
        assert ei.value.__suppress_context__ or ei.value.__context__ is None


def test_api_key_env(monkeypatch):
    monkeypatch.delenv("ECOS_API_KEY", raising=False)
    assert ecos.api_key() is None
    monkeypatch.setenv("ECOS_API_KEY", "  ")
    assert ecos.api_key() is None
    monkeypatch.setenv("ECOS_API_KEY", " abc ")
    assert ecos.api_key() == "abc"


# ---------------------------------------------------------------- 태스크
@pytest.fixture
def local_default(monkeypatch):
    monkeypatch.delenv("MARKET_DATA_SOURCE", raising=False)
    monkeypatch.delenv("CLICKHOUSE_LOCAL_HOST", raising=False)


def _fakes(monkeypatch, seen, latest=None, rows=None, exc=None):
    class C:
        def __init__(self, key):
            seen.append(("client", key))

        def usdkrw_daily(self, start, end):
            seen.append(("fetch", start, end))
            if exc is not None:
                raise exc
            return rows if rows is not None else [(date(2026, 11, 18), 1384.5), (date(2026, 11, 19), 1385.2)]

    monkeypatch.setenv("ECOS_API_KEY", KEY)
    monkeypatch.setattr(md.ecos, "EcosClient", C)
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda **kw: seen.append(("ensure", kw)))
    monkeypatch.setattr(md.chm, "latest_macro_date", lambda s, **kw: seen.append(("latest", s, kw)) or latest)
    monkeypatch.setattr(md.chm, "upsert_macro", lambda s, obs, **kw: seen.append(("upsert", s, kw)) or len(obs))


def test_task_skipped_without_key(monkeypatch, local_default):
    monkeypatch.delenv("ECOS_API_KEY", raising=False)
    monkeypatch.setattr(md.chm, "ensure_market_tables", lambda **kw: (_ for _ in ()).throw(AssertionError("CH 접근")))
    assert md.collect_ecos_usdkrw() == {"skipped": "ECOS_API_KEY 없음"}


def test_task_first_run_backfills_then_overlaps(monkeypatch, local_default):
    seen = []
    _fakes(monkeypatch, seen)
    out = md.collect_ecos_usdkrw(today=date(2026, 11, 20))
    assert out == {"series_id": "ECOS:USDKRW", "inserted": 2, "latest": "2026-11-19"}
    fetch = next(x for x in seen if x[0] == "fetch")
    assert fetch[1] == date(2026, 11, 20) - md.timedelta(days=md.ECOS_BACKFILL_DAYS) and fetch[2] == date(2026, 11, 20)
    assert ("upsert", "ECOS:USDKRW", {}) in seen

    seen.clear()
    _fakes(monkeypatch, seen, latest=date(2026, 11, 19))
    md.collect_ecos_usdkrw(today=date(2026, 11, 20))
    fetch = next(x for x in seen if x[0] == "fetch")
    assert fetch[1] == date(2026, 10, 20)  # 최신 - 30일 겹침


def test_task_failure_does_not_leak_key(monkeypatch, local_default, caplog):
    seen = []
    _fakes(monkeypatch, seen, exc=RuntimeError(f"boom https://ecos.bok.or.kr/api/StatisticSearch/{KEY}/json"))
    with caplog.at_level(logging.INFO):
        out = md.collect_ecos_usdkrw(today=date(2026, 11, 20))
    assert out["inserted"] == 0 and out["error"] == "RuntimeError"
    assert KEY not in caplog.text and KEY not in repr(out)

    seen.clear()
    caplog.clear()
    _fakes(monkeypatch, seen, exc=ecos.EcosError("ECOS 오류 INFO-100: 인증키가 유효하지 않습니다."))
    with caplog.at_level(logging.INFO):
        out = md.collect_ecos_usdkrw(today=date(2026, 11, 20))
    assert "INFO-100" in out["error"] and KEY not in caplog.text and KEY not in repr(out)


def test_task_readonly_without_local_skips(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_SOURCE", "prod_readonly")
    monkeypatch.delenv("CLICKHOUSE_LOCAL_HOST", raising=False)
    seen = []
    _fakes(monkeypatch, seen)
    assert md.collect_ecos_usdkrw(today=date(2026, 11, 20)) == {"skipped": "prod_readonly"}
    assert seen == []  # 상용 CH·ECOS 둘 다 건드리지 않음


def test_task_readonly_with_local_writes_local(monkeypatch):
    monkeypatch.setenv("MARKET_DATA_SOURCE", "prod_readonly")
    monkeypatch.setenv("CLICKHOUSE_LOCAL_HOST", "clickhouse")
    local = object()
    monkeypatch.setattr(md, "get_local_client", lambda: local)
    seen = []
    _fakes(monkeypatch, seen)
    md.collect_ecos_usdkrw(today=date(2026, 11, 20))
    ch_calls = [x for x in seen if x[0] in ("ensure", "latest", "upsert")]
    assert [x[-1]["client"] for x in ch_calls] == [local, local, local]


def test_beat_registered_and_kept_in_readonly():
    assert "collector.collect_ecos_usdkrw" in ca.celery_app.tasks
    base = {"collect-ecos-usdkrw": {"task": "collector.collect_ecos_usdkrw"}}
    assert "collect-ecos-usdkrw" in ca.readonly_beat_schedule(base)
    from apps.collector.celery_app import celery_app
    # 기본(local) beat 에 평일 2회
    names = [n for n, e in celery_app.conf.beat_schedule.items() if e["task"] == "collector.collect_ecos_usdkrw"]
    assert sorted(names) == ["collect-ecos-usdkrw", "collect-ecos-usdkrw-retry"]


# ---------------------------------------------------------------- 저장 멱등
class _FakeCH:
    """insert 를 모아 두고 FINAL 처럼 (series_id, date) 마지막 행만 남겨 읽는다(ReplacingMergeTree(ingested_at) 흉내)."""

    def __init__(self):
        self.rows = []

    def insert(self, table, rows, column_names):
        assert table.endswith(".macro_series") and column_names == ["series_id", "date", "value"]
        self.rows.extend(rows)

    def final(self):
        out = {}
        for sid, d, v in self.rows:
            out[(sid, d)] = v
        return out


def test_overlap_recollect_is_idempotent():
    fake = _FakeCH()
    first = [(date(2026, 11, 18), 1384.5), (date(2026, 11, 19), 1385.2)]
    again = [(date(2026, 11, 19), 1385.2), (date(2026, 11, 20), 1390.0)]
    chm.upsert_macro("ECOS:USDKRW", first, client=fake)
    chm.upsert_macro("ECOS:USDKRW", again, client=fake)
    assert fake.final() == {("ECOS:USDKRW", date(2026, 11, 18)): 1384.5, ("ECOS:USDKRW", date(2026, 11, 19)): 1385.2,
                            ("ECOS:USDKRW", date(2026, 11, 20)): 1390.0}
    # 테이블이 같은 키를 하나로 접는 엔진인지(멱등의 근거)
    assert "ReplacingMergeTree(ingested_at)" in chm.MACRO_DDL and "ORDER BY (series_id, date)" in chm.MACRO_DDL

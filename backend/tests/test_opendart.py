"""OpenDartClient — MockTransport + 메모리 zip(실제 DART 호출 없음)."""
from __future__ import annotations

import io
import zipfile
from datetime import date

import httpx
import pytest

from apps.ai_analyst.clients import opendart
from apps.ai_analyst.clients.opendart import Disclosure, OpenDartClient, parse_corp_code_zip, red_flag_hints

_XML = """<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code><modify_date>20260101</modify_date></list>
  <list><corp_code>00999999</corp_code><corp_name>비상장사</corp_name><stock_code> </stock_code><modify_date>20260101</modify_date></list>
  <list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code><modify_date>20260101</modify_date></list>
</result>"""


def _zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("CORPCODE.xml", _XML.encode("utf-8"))
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_cache():
    opendart.clear_corp_code_cache()
    yield
    opendart.clear_corp_code_cache()


class _Router:
    def __init__(self, list_body=None, corp_status=200):
        self.list_body = list_body or {"status": "013", "message": "조회된 데이타가 없습니다."}
        self.corp_status = corp_status
        self.calls: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        if req.url.path.endswith("/corpCode.xml"):
            if self.corp_status != 200:
                return httpx.Response(self.corp_status)
            return httpx.Response(200, content=_zip())
        if req.url.path.endswith("/list.json"):
            return httpx.Response(200, json=self.list_body)
        return httpx.Response(404)

    def count(self, suffix):
        return sum(1 for r in self.calls if r.url.path.endswith(suffix))


def test_parse_corp_code_zip_skips_unlisted():
    assert parse_corp_code_zip(_zip()) == {"005930": "00126380", "000660": "00164779"}


def test_corp_code_cached_per_day():
    router = _Router()
    day = {"v": date(2026, 10, 30)}
    c = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: day["v"])
    assert c.corp_code("005930") == "00126380"
    assert c.corp_code("000660") == "00164779"
    assert c.corp_code("123456") is None
    # 다른 인스턴스여도 프로세스 캐시 공유
    c2 = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: day["v"])
    assert c2.corp_code("005930") == "00126380"
    assert router.count("/corpCode.xml") == 1
    assert router.calls[0].url.params["crtfc_key"] == "k"
    day["v"] = date(2026, 10, 31)  # 날짜가 바뀌면 다시 받는다
    assert c.corp_code("005930") == "00126380"
    assert router.count("/corpCode.xml") == 2


def test_corp_code_download_failure_returns_none():
    router = _Router(corp_status=500)
    c = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: date(2026, 10, 30))
    assert c.corp_code("005930") is None
    assert c.disclosures("005930") == []


def test_disclosures_ok():
    body = {"status": "000", "message": "정상", "list": [
        {"corp_name": "삼성전자", "report_nm": "주요사항보고서(전환사채권발행결정)", "rcept_no": "20261020000123",
         "rcept_dt": "20261020", "flr_nm": "삼성전자"},
        {"corp_name": "삼성전자", "report_nm": "분기보고서 (2026.09)", "rcept_no": "20261028000456",
         "rcept_dt": "20261028", "flr_nm": "삼성전자"},
    ]}
    router = _Router(list_body=body)
    c = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: date(2026, 10, 30))
    items = c.disclosures("005930", days=90)
    assert [d.report_nm for d in items] == ["주요사항보고서(전환사채권발행결정)", "분기보고서 (2026.09)"]
    assert items[0].url.endswith("20261020000123")
    req = [r for r in router.calls if r.url.path.endswith("/list.json")][0]
    assert req.url.params["corp_code"] == "00126380"
    assert req.url.params["bgn_de"] == "20260801"
    assert req.url.params["end_de"] == "20261030"
    assert req.url.params["page_count"] == "100"


def test_disclosures_013_empty():
    router = _Router()
    c = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: date(2026, 10, 30))
    assert c.disclosures("005930") == []


def test_disclosures_unknown_stock_skips_list_call():
    router = _Router()
    c = OpenDartClient("k", transport=httpx.MockTransport(router), today=lambda: date(2026, 10, 30))
    assert c.disclosures("999999") == []
    assert router.count("/list.json") == 0


def _d(name: str) -> Disclosure:
    return Disclosure(report_nm=name, rcept_no="1", rcept_dt="20261030", flr_nm="x", corp_name="x")


def test_red_flag_hints():
    hints = red_flag_hints([
        _d("주요사항보고서(전환사채권발행결정)"),
        _d("[기재정정]주요사항보고서(전환사채권발행결정)"),
        _d("주요사항보고서(유상증자결정)"),
        _d("최대주주 변경"),
        _d("최대주주변경을수반하는주식양수도계약체결"),
        _d("횡령ㆍ배임혐의발생"),
        _d("분기보고서 (2026.09)"),
    ])
    assert len(hints) == len(set(hints))
    assert any("전환사채" in h for h in hints)
    assert any("유상증자" in h for h in hints)
    assert sum("최대주주" in h for h in hints) == 1
    assert any("횡령" in h for h in hints) and any("배임" in h for h in hints)
    assert red_flag_hints([_d("분기보고서 (2026.09)")]) == []

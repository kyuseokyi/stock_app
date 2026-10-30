"""NaverNewsClient — httpx.MockTransport(실제 네이버 호출 없음)."""
from __future__ import annotations

import httpx

from apps.ai_analyst.clients.naver_news import NaverNewsClient, clean_text, mover_query, theme_query

_BODY = {
    "items": [
        {
            "title": "<b>삼성전자</b>, &quot;HBM&quot; 수주 기대 &amp; 강세",
            "originallink": "https://news.example.com/a",
            "link": "https://n.news.naver.com/a",
            "description": "삼성전자가 <b>특징주</b>로 &lt;급등&gt;",
            "pubDate": "Thu, 30 Oct 2026 09:12:00 +0900",
        }
    ]
}


def _transport(status: int, body=None, calls=None):
    def handler(req: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(req)
        return httpx.Response(status, json=body or {})

    return httpx.MockTransport(handler)


def test_search_parses_and_cleans():
    calls: list[httpx.Request] = []
    c = NaverNewsClient("cid", "csec", transport=_transport(200, _BODY, calls))
    items = c.search("삼성전자 특징주", display=3, sort="date")
    assert len(items) == 1
    it = items[0]
    assert it.title == '삼성전자, "HBM" 수주 기대 & 강세'
    assert it.description == "삼성전자가 특징주로 <급등>"
    assert it.originallink == "https://news.example.com/a"
    assert it.link == "https://n.news.naver.com/a"
    assert it.pub_date.startswith("Thu, 30 Oct 2026")
    req = calls[0]
    assert req.url.host == "openapi.naver.com"
    assert req.url.path == "/v1/search/news.json"
    assert req.headers["X-Naver-Client-Id"] == "cid"
    assert req.headers["X-Naver-Client-Secret"] == "csec"
    assert req.url.params["query"] == "삼성전자 특징주"
    assert req.url.params["display"] == "3"
    assert req.url.params["sort"] == "date"


def test_401_returns_empty():
    c = NaverNewsClient("cid", "bad", transport=_transport(401, {"errorCode": "024"}))
    assert c.search("x") == []


def test_500_and_timeout_return_empty():
    assert NaverNewsClient("a", "b", transport=_transport(500)).search("x") == []

    def boom(req):
        raise httpx.ReadTimeout("timeout", request=req)

    assert NaverNewsClient("a", "b", transport=httpx.MockTransport(boom)).search("x") == []


def test_query_helpers():
    assert mover_query("에코프로") == ("에코프로 특징주", "date")
    assert theme_query("2차전지") == ("2차전지 관련주", "sim")


def test_clean_text_none():
    assert clean_text(None) == ""

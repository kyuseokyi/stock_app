"""네이버 검색 Open API — 뉴스 검색(https://openapi.naver.com/v1/search/news.json).

키: NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET (로그인 앱 키와 별개).
제목·요약에는 `<b>` 강조 태그와 `&quot;` 같은 HTML 엔티티가 섞여 오므로 제거한다.
4xx/5xx/타임아웃은 빈 리스트 + warning.
"""
from __future__ import annotations

import html
import logging
import re
from dataclasses import dataclass

import httpx

from shared import config

log = logging.getLogger(__name__)

NEWS_URL = "https://openapi.naver.com/v1/search/news.json"
_TIMEOUT = 10.0
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class NewsItem:
    title: str
    description: str
    originallink: str
    link: str
    pub_date: str  # RFC 822 원문(예: "Thu, 30 Oct 2026 09:12:00 +0900")


def clean_text(s: str | None) -> str:
    """HTML 태그 제거 → 엔티티 해제(&quot; &amp; 등) → 공백 정리."""
    s = _TAG_RE.sub("", s or "")
    s = html.unescape(s)
    return " ".join(s.split())


def mover_query(name: str) -> tuple[str, str]:
    """급등·급락 종목 원인 뉴스 — (검색어, 정렬) = 최신순."""
    return f"{name} 특징주", "date"


def theme_query(name: str) -> tuple[str, str]:
    """테마·핫 키워드 관련 뉴스 — (검색어, 정렬) = 정확도순."""
    return f"{name} 관련주", "sim"


class NaverNewsClient:
    def __init__(self, client_id: str, client_secret: str, transport: httpx.BaseTransport | None = None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._transport = transport

    def search(self, query: str, *, display: int = 5, sort: str = "date") -> list[NewsItem]:
        headers = {"X-Naver-Client-Id": self._client_id, "X-Naver-Client-Secret": self._client_secret}
        params = {"query": query, "display": display, "sort": sort}
        try:
            with httpx.Client(transport=self._transport, timeout=_TIMEOUT) as c:
                resp = c.get(NEWS_URL, headers=headers, params=params)
            resp.raise_for_status()
            items = resp.json().get("items") or []
        except httpx.HTTPStatusError as e:
            log.warning("네이버 뉴스 검색 실패 (HTTP %s)", e.response.status_code)
            return []
        except Exception as e:  # noqa: BLE001 — 타임아웃·연결·JSON 오류
            log.warning("네이버 뉴스 검색 실패 (%s)", type(e).__name__)
            return []
        out: list[NewsItem] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            out.append(NewsItem(
                title=clean_text(it.get("title")),
                description=clean_text(it.get("description")),
                originallink=str(it.get("originallink") or ""),
                link=str(it.get("link") or ""),
                pub_date=str(it.get("pubDate") or ""),
            ))
        return out


def get_naver_news_client() -> NaverNewsClient | None:
    cid, secret = config.naver_search_client_id(), config.naver_search_client_secret()
    if not (cid and secret):
        return None
    return NaverNewsClient(cid, secret)

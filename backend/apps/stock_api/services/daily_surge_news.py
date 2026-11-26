"""급등락 화면 — 네이버 뉴스 바로 보기(저장 안 함).

네이버 검색 API 약관(2026-09-07 시행, docs/naver-search-api-terms-issue.md 6-1절)을 지킨다:
- N1 받은 순서·개수 그대로(기사마다 시각 배지 time_slot 만 덧붙임 — 빼거나 다시 늘어놓지 않음)
- N2 정렬은 네이버 옵션(sort=date)만 · N3 검색어 하나 = 목록 하나(합치지 않음)
- N4 응답에 출처(source) · N5 원문 링크 · N6 DB 저장 없음, 검색어 단위 Redis 5분 캐시만
- N7 AI 입력 금지(이 모듈은 Gemini 를 부르지 않는다) · N8 관리자 화면(광고 없음)
검색어는 서버가 만든다(종목 "{이름} 특징주", 테마 "{이름} 관련주") — 임의 검색어를 받지 않는다.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import date, timedelta
from urllib.parse import urlparse

from apps.ai_analyst.clients.naver_news import NewsItem, get_naver_news_client, mover_query, theme_query
from apps.collector.daily_surge.compute import parse_pub_date, time_slot
from shared import market_calendar
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

SOURCE = "naver_news_search"
CACHE_TTL = 300
DISPLAY = 10

__all__ = ["NewsItem", "fetch", "query_for"]


def query_for(kind: str, name: str) -> str:
    return (mover_query(name) if kind == "stock" else theme_query(name))[0]


def _prev_trading_day(d: date) -> date:
    p = d - timedelta(days=1)
    for _ in range(14):
        if market_calendar.is_trading_day(p):
            return p
        p -= timedelta(days=1)
    return d - timedelta(days=1)


def _cache_key(query: str) -> str:
    return "naver:news:" + hashlib.sha1(query.encode("utf-8")).hexdigest()


def _search(query: str) -> list[dict] | None:
    """검색어 결과(캐시 우선). 키 없음 → None, 빈 결과는 캐시하지 않는다(다음 요청에 다시 시도)."""
    try:
        cached = get_sync_redis().get(_cache_key(query))
        if cached:
            return json.loads(cached)
    except Exception:  # noqa: BLE001 — 캐시가 죽어도 조회는 한다
        log.warning("뉴스 캐시 읽기 실패")
    client = get_naver_news_client()
    if client is None:
        return None
    items = [{"title": it.title, "url": it.originallink or it.link, "pub_date": it.pub_date}
             for it in client.search(query, display=DISPLAY, sort="date")]
    if items:
        try:
            get_sync_redis().set(_cache_key(query), json.dumps(items, ensure_ascii=False), ex=CACHE_TTL)
        except Exception:  # noqa: BLE001
            log.warning("뉴스 캐시 쓰기 실패")
    return items


def fetch(kind: str, name: str, trade_date: date) -> dict:
    query = query_for(kind, name)
    raw = _search(query) or []
    prev = _prev_trading_day(trade_date)
    items = []
    for it in raw:
        pub = parse_pub_date(it.get("pub_date"))
        items.append({
            "title": it.get("title") or "", "url": it.get("url") or "",
            "press_domain": urlparse(it.get("url") or "").netloc,
            "published_at": pub.isoformat() if pub else None,
            "time_slot": time_slot(pub, trade_date, prev),
        })
    return {"source": SOURCE, "query": query, "unavailable": not items, "items": items}

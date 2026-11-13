"""AI 요약 근거 기사(sources) — LLM 에 넣은 뉴스 항목으로 서비스가 직접 채운다(R3).

모델 출력 스키마(response_schema)에는 넣지 않는다 — 모델이 링크를 지어내지 않게.
항목: {title, url, pub_date}. url 은 originallink(언론사 원문) 우선, 없으면 link(네이버 뉴스). 둘 다 없으면 뺀다.
pub_date 는 네이버 RFC 822 원문을 ISO 8601 로 바꾼다(해석 실패면 None).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from email.utils import parsedate_to_datetime

MAX_SOURCES = 3


def _get(obj, key: str):
    if isinstance(obj, Mapping):
        return obj.get(key)
    return getattr(obj, key, None)


def _iso(raw) -> str | None:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(str(raw)).isoformat()
    except (TypeError, ValueError, IndexError):
        return None


def news_sources(items: Iterable | None, limit: int = MAX_SOURCES) -> list[dict]:
    """뉴스 항목(NewsItem 또는 dict) → [{title, url, pub_date}] 최대 limit 개, 같은 url 은 한 번만."""
    out: list[dict] = []
    seen: set[str] = set()
    for n in items or []:
        url = (_get(n, "originallink") or _get(n, "link") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({"title": (_get(n, "title") or "").strip(), "url": url, "pub_date": _iso(_get(n, "pub_date"))})
        if len(out) >= limit:
            break
    return out

"""KIS 순위 조회 — 등락률 상위/하위(급등·급락). 시장코드는 UN(통합) 우선 → 비거나 실패하면 J(KRX) 폴백."""
from __future__ import annotations

import logging

from apps.collector.kis.client import DOMESTIC_MARKET_CODE, KRX_MARKET_CODE
from apps.collector.market_parsers import parse_fluctuation

log = logging.getLogger(__name__)


def fetch_fluctuation(client, descending: bool) -> list[dict]:
    """등락률 순위(파싱 완료). client 는 `get_fluctuation_ranking(descending=, market_code=)` 를 가진 객체.

    UN 결과가 비거나(파싱 후 0행) 예외면 J 로 재조회한다. J 예외는 상위로 전파.
    """
    try:
        rows = parse_fluctuation(client.get_fluctuation_ranking(descending=descending,
                                                                market_code=DOMESTIC_MARKET_CODE))
    except Exception as e:  # noqa: BLE001 — UN 거부/오류는 J 폴백으로 흡수
        log.warning("등락률 순위 UN 조회 실패 → J 폴백 (%s)", type(e).__name__)
        rows = []
    if rows:
        return rows
    return parse_fluctuation(client.get_fluctuation_ranking(descending=descending, market_code=KRX_MARKET_CODE))

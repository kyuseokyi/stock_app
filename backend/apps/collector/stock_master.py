"""국내 전종목 마스터 로더 (소스 무관).

수집 태스크는 이 함수로 "수집 대상 종목 목록"을 얻는다. 소스는 교체 가능:
  - 'mst'      : KRX 마스터(.mst) 다운로드/파싱 → 진짜 전종목(~2,800)
  - 'fallback' : 코드 내 정적 대형주 리스트(다운로드 불가 환경 검증용)
  - 'auto'(기본): mst 시도 → 실패 시 fallback 자동 전환

⚠️ 신규상장/상장폐지는 KIS 시세 API가 목록을 주지 않는다. KIS가 매일 갱신하는
   .mst 를 매 수집마다 다시 로드하면 종목 변동이 자동 반영된다(캐시는 Redis TTL로 옵션).
"""

from __future__ import annotations

import logging
import os

from apps.collector.kis.master import MasterStock

logger = logging.getLogger(__name__)

# 다운로드 불가 환경(샌드박스 등) 검증용 fallback — KOSPI/KOSDAQ 대형주.
_FALLBACK: list[MasterStock] = [
    MasterStock("005930", "삼성전자", "KOSPI"),
    MasterStock("000660", "SK하이닉스", "KOSPI"),
    MasterStock("373220", "LG에너지솔루션", "KOSPI"),
    MasterStock("207940", "삼성바이오로직스", "KOSPI"),
    MasterStock("005380", "현대차", "KOSPI"),
    MasterStock("000270", "기아", "KOSPI"),
    MasterStock("068270", "셀트리온", "KOSPI"),
    MasterStock("035420", "NAVER", "KOSPI"),
    MasterStock("035720", "카카오", "KOSPI"),
    MasterStock("051910", "LG화학", "KOSPI"),
    MasterStock("006400", "삼성SDI", "KOSPI"),
    MasterStock("105560", "KB금융", "KOSPI"),
    MasterStock("005490", "POSCO홀딩스", "KOSPI"),
    MasterStock("012330", "현대모비스", "KOSPI"),
    MasterStock("055550", "신한지주", "KOSPI"),
    MasterStock("003670", "포스코퓨처엠", "KOSPI"),
    MasterStock("247540", "에코프로비엠", "KOSDAQ"),
    MasterStock("086520", "에코프로", "KOSDAQ"),
    MasterStock("091990", "셀트리온헬스케어", "KOSDAQ"),
    MasterStock("196170", "알테오젠", "KOSDAQ"),
]


def load_domestic_tickers(source: str | None = None) -> list[MasterStock]:
    """수집 대상 국내 전종목 목록을 반환. source: 'mst'|'fallback'|'auto'(기본)."""
    source = (source or os.getenv("STOCK_MASTER_SOURCE", "auto")).strip().lower()

    if source == "fallback":
        return list(_FALLBACK)

    if source in ("mst", "auto"):
        try:
            from apps.collector.kis.master import download_and_parse_master

            stocks = download_and_parse_master()
            if stocks:
                logger.info("전종목 마스터(.mst) 로드: %d종목", len(stocks))
                return stocks
            raise RuntimeError("마스터 파싱 결과가 비어 있음")
        except Exception as e:
            if source == "mst":
                raise
            logger.warning("마스터(.mst) 로드 실패 → fallback(%d종목) 사용: %s", len(_FALLBACK), e)
            return list(_FALLBACK)

    raise ValueError(f"알 수 없는 STOCK_MASTER_SOURCE: {source}")

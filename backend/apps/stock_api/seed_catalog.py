"""종목/지수 시드 카탈로그 (인메모리).

실데이터 파이프라인/StockMeta(Postgres) 도입 전까지 사용하는 조회용 마스터.
국내 주식 + 미국 주식 + 주요 지수를 통합 검색 대상으로 제공한다.
실데이터 전환 시 이 모듈만 DB 조회로 교체하면 된다.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SeedStock:
    symbol: str  # 조회 키 (종목코드/티커/지수코드)
    name: str  # 표시 이름
    market: str  # KOSPI / KOSDAQ / NASDAQ / NYSE / INDEX
    country: str  # KR / US / GLOBAL
    currency: str  # KRW / USD / PT(지수 포인트)


# 국내 주식 (KOSPI/KOSDAQ)
_KR_STOCKS = [
    SeedStock("005930", "삼성전자", "KOSPI", "KR", "KRW"),
    SeedStock("000660", "SK하이닉스", "KOSPI", "KR", "KRW"),
    SeedStock("373220", "LG에너지솔루션", "KOSPI", "KR", "KRW"),
    SeedStock("207940", "삼성바이오로직스", "KOSPI", "KR", "KRW"),
    SeedStock("005380", "현대차", "KOSPI", "KR", "KRW"),
    SeedStock("000270", "기아", "KOSPI", "KR", "KRW"),
    SeedStock("068270", "셀트리온", "KOSPI", "KR", "KRW"),
    SeedStock("035420", "NAVER", "KOSPI", "KR", "KRW"),
    SeedStock("035720", "카카오", "KOSPI", "KR", "KRW"),
    SeedStock("051910", "LG화학", "KOSPI", "KR", "KRW"),
    SeedStock("006400", "삼성SDI", "KOSPI", "KR", "KRW"),
    SeedStock("105560", "KB금융", "KOSPI", "KR", "KRW"),
    SeedStock("005490", "POSCO홀딩스", "KOSPI", "KR", "KRW"),
    SeedStock("247540", "에코프로비엠", "KOSDAQ", "KR", "KRW"),
    SeedStock("086520", "에코프로", "KOSDAQ", "KR", "KRW"),
]

# 미국 주식 (NASDAQ/NYSE)
_US_STOCKS = [
    SeedStock("AAPL", "Apple Inc.", "NASDAQ", "US", "USD"),
    SeedStock("MSFT", "Microsoft", "NASDAQ", "US", "USD"),
    SeedStock("NVDA", "NVIDIA", "NASDAQ", "US", "USD"),
    SeedStock("GOOGL", "Alphabet (Google)", "NASDAQ", "US", "USD"),
    SeedStock("AMZN", "Amazon", "NASDAQ", "US", "USD"),
    SeedStock("META", "Meta Platforms", "NASDAQ", "US", "USD"),
    SeedStock("TSLA", "Tesla", "NASDAQ", "US", "USD"),
    SeedStock("AVGO", "Broadcom", "NASDAQ", "US", "USD"),
    SeedStock("NFLX", "Netflix", "NASDAQ", "US", "USD"),
    SeedStock("AMD", "Advanced Micro Devices", "NASDAQ", "US", "USD"),
    SeedStock("JPM", "JPMorgan Chase", "NYSE", "US", "USD"),
    SeedStock("V", "Visa", "NYSE", "US", "USD"),
    SeedStock("KO", "Coca-Cola", "NYSE", "US", "USD"),
    SeedStock("DIS", "Walt Disney", "NYSE", "US", "USD"),
    SeedStock("BABA", "Alibaba", "NYSE", "US", "USD"),
]

# 주요 지수
_INDICES = [
    SeedStock("^KS11", "KOSPI 지수", "INDEX", "KR", "PT"),
    SeedStock("^KQ11", "KOSDAQ 지수", "INDEX", "KR", "PT"),
    SeedStock("^GSPC", "S&P 500", "INDEX", "US", "PT"),
    SeedStock("^IXIC", "NASDAQ 종합", "INDEX", "US", "PT"),
    SeedStock("^DJI", "다우존스", "INDEX", "US", "PT"),
    SeedStock("^N225", "닛케이 225", "INDEX", "GLOBAL", "PT"),
]

CATALOG: list[SeedStock] = [*_KR_STOCKS, *_US_STOCKS, *_INDICES]

_BY_SYMBOL: dict[str, SeedStock] = {s.symbol: s for s in CATALOG}


def get_by_symbol(symbol: str) -> SeedStock | None:
    """심볼로 종목 단건 조회."""
    return _BY_SYMBOL.get(symbol)


def search(query: str, limit: int = 20) -> list[SeedStock]:
    """이름/심볼 부분일치(대소문자 무시) 통합 검색.

    국내·해외·지수를 모두 포함하며, 심볼 시작 일치 → 이름 포함 순으로 우선한다.
    """
    q = query.strip().lower()
    if not q:
        return []

    def rank(s: SeedStock) -> int:
        sym, name = s.symbol.lower(), s.name.lower()
        if sym == q or name == q:
            return 0
        if sym.startswith(q) or name.startswith(q):
            return 1
        if q in sym or q in name:
            return 2
        return 99

    scored = [(rank(s), s) for s in CATALOG]
    matched = [(r, s) for r, s in scored if r < 99]
    matched.sort(key=lambda t: (t[0], t[1].name))
    return [s for _, s in matched[:limit]]

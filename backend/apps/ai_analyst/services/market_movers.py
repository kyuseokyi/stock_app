"""실시간 급등·급락 종목 + AI 원인 분석 + 핫 키워드 — KIS 등락률 순위 → 네이버 뉴스 → Gemini(1회) → Redis.

- 20종목(상승 10 + 하락 10)을 Gemini 한 번으로 묶는다(`MoverReasonsResponse`). 응답은 ticker 로 매칭, 빠진 종목은 원인 None.
- KIS 실패(또는 두 목록 모두 빈 결과)면 이전 캐시를 덮지 않는다.
- Gemini 가 없으면 원인 None 인 목록이라도 캐시한다(시세 목록 자체는 유효).
"""
from __future__ import annotations

import logging
from datetime import datetime, time

from apps.ai_analyst import cache, prompts
from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.clients.naver_news import get_naver_news_client, mover_query, theme_query
from apps.ai_analyst.schemas import HotKeywordsResponse, MarketMoversResponse, Mover, MoverReasonsResponse
from apps.collector.intraday_indices import KST
from apps.collector.kis.ranking import fetch_fluctuation
from shared import market_calendar

log = logging.getLogger(__name__)

TOP_N = 10
NEWS_PER_STOCK = prompts.NEWS_PER_ITEM  # 5
KEYWORD_NEWS_STOCKS = 5  # 핫 키워드용 테마 뉴스를 찾을 상위 종목 수(상승·하락 각각)
SESSION_START = time(9, 10)
SESSION_END = time(15, 30)


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _gemini():
    return get_gemini_client()


def _news():
    return get_naver_news_client()


def _fetch(kis_client, descending: bool) -> list[dict]:
    return fetch_fluctuation(kis_client, descending)


def _universe() -> set[str]:
    """보통주 분석 유니버스(ETF·스팩·우선주 제외)."""
    from shared import market_repo
    from shared.database import SyncSessionLocal

    with SyncSessionLocal() as db:
        return {t for t, _n, _m in market_repo.analysis_universe(db)}


def _now() -> datetime:
    return datetime.now(KST)


# ---------------------------------------------------------------- 보조(순수 함수)
def norm_ticker(t) -> str:
    """'A005930'·' 5930' → '005930'. Gemini 가 접두어·0 을 빼먹어도 매칭되게."""
    s = str(t or "").strip().upper()
    if s.startswith("A") and s[1:].isdigit():
        s = s[1:]
    return s.zfill(6) if s.isdigit() else s


def _pick(rows: list[dict], universe: set[str], *, up: bool) -> list[dict]:
    out = []
    for r in rows or []:
        rate = r.get("change_rate")
        if r.get("ticker") not in universe or rate is None:
            continue
        # 정렬 코드(특히 하락 "1")가 실호출 미검증이라 방향을 다시 확인한다
        if (up and rate <= 0) or (not up and rate >= 0):
            continue
        out.append(r)
        if len(out) >= TOP_N:
            break
    return out


def in_session_window(now: datetime) -> bool:
    """KST 거래일(주말·공휴일·KRX 연말·수동 휴장 제외)이고 09:10 ≤ 시각 ≤ 15:30(분 단위, 양끝 포함). naive 는 KST 로 본다.

    분 단위로 비교한다 — beat 가 15:30:02 처럼 몇 초 늦게 깨워도 마지막 회차가 빠지지 않게.
    """
    now = now.replace(tzinfo=KST) if now.tzinfo is None else now.astimezone(KST)
    if not market_calendar.is_trading_day(now.date()):
        return False
    return SESSION_START <= now.time().replace(second=0, microsecond=0) <= SESSION_END


# ---------------------------------------------------------------- 순위
def fetch_movers(kis_client, *, universe: set[str]) -> tuple[list[dict], list[dict]]:
    """(상승 상위, 하락 상위) — 보통주 유니버스 안의 종목만 각 TOP_N. KIS 예외는 호출자에게 올린다."""
    gainers = _pick(_fetch(kis_client, True), universe, up=True)
    losers = _pick(_fetch(kis_client, False), universe, up=False)
    return gainers, losers


def _stock_news(news_client, rows: list[dict]) -> dict[str, list]:
    if news_client is None:
        return {}
    out: dict[str, list] = {}
    for r in rows:
        q, sort = mover_query(r.get("name") or r["ticker"])
        try:
            out[r["ticker"]] = news_client.search(q, display=NEWS_PER_STOCK, sort=sort)
        except Exception as exc:  # noqa: BLE001 — 종목 하나 뉴스 실패는 뉴스 없이
            log.warning("급등락 뉴스 조회 실패(%s): %s", r["ticker"], type(exc).__name__)
            out[r["ticker"]] = []
    return out


def _to_mover(r: dict, reason) -> dict:
    m = Mover(ticker=r["ticker"], stock_name=r.get("name") or r["ticker"], price=r.get("price"),
              change_rate=r["change_rate"])
    if reason is not None:
        m = m.model_copy(update={"reason_summary": reason.reason_summary, "category": reason.category,
                                 "reliability": reason.reliability, "risk_warning": reason.risk_warning})
    return m.model_dump()


def _reasons(gemini, gainers, losers, news_by_ticker) -> dict:
    """Gemini 1회 → {ticker: MoverReasonItem}. Gemini 없거나 실패면 {}."""
    if gemini is None:
        return {}
    resp = gemini.generate_json(prompts.movers_prompt(gainers, losers, news_by_ticker), MoverReasonsResponse,
                                system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return {}
    return {norm_ticker(it.ticker): it for it in resp.items}


# ---------------------------------------------------------------- 진입점
def analyze(now: datetime, *, kis_client, session=None, force: bool = False) -> dict:
    """급등락 원인 분석 → 캐시. 반환은 API 계약 모양 dict, 건너뛰면 {"skipped": 사유}.

    session: 유니버스 조회에 쓸 동기 세션(없으면 SyncSessionLocal 을 직접 연다).
    """
    if not force:
        hit = cache.get_json(cache.MOVERS_KEY)
        if hit:
            return {**hit, "keywords": cache.get_json(cache.KEYWORDS_KEY) or []}

    try:
        if session is not None:
            from shared import market_repo

            universe = {t for t, _n, _m in market_repo.analysis_universe(session)}
        else:
            universe = _universe()
    except Exception as exc:  # noqa: BLE001 — PG 장애
        log.warning("분석 유니버스 조회 실패(%s) — 급등락 갱신 건너뜀", type(exc).__name__)
        if session is not None:
            session.rollback()
        return {"skipped": "universe_error"}
    if not universe:
        return {"skipped": "empty_universe"}

    try:
        gainers, losers = fetch_movers(kis_client, universe=universe)
    except Exception as exc:  # noqa: BLE001 — KIS 실패면 이전 캐시를 그대로 둔다
        log.warning("등락률 순위 조회 실패(%s) — 이전 캐시 유지", type(exc).__name__)
        return {"skipped": "kis_error"}
    if not gainers and not losers:
        return {"skipped": "no_movers"}

    gemini = _gemini()
    news = _stock_news(_news(), gainers + losers) if gemini is not None else {}
    reasons = _reasons(gemini, gainers, losers, news)

    now_kst = now.replace(tzinfo=KST) if now.tzinfo is None else now.astimezone(KST)
    body = MarketMoversResponse(
        updated_at=now_kst.isoformat(timespec="seconds"),
        gainers=[_to_mover(r, reasons.get(r["ticker"])) for r in gainers],
        losers=[_to_mover(r, reasons.get(r["ticker"])) for r in losers],
    ).model_dump(exclude={"keywords"})
    cache.put_json(cache.MOVERS_KEY, body, cache.MOVERS_TTL)
    return {**body, "keywords": cache.get_json(cache.KEYWORDS_KEY) or []}


def hot_keywords(movers: dict, *, force: bool = False) -> list[dict]:
    """핫 키워드 — 캐시가 있으면 그대로, 없으면 movers + 테마 뉴스로 Gemini 1회 → 캐시.

    Gemini 가 없거나 실패하면 [] 를 반환하되 캐시하지 않는다(키를 넣은 뒤 30분 동안 빈 값이 나오지 않게).
    """
    if not force:
        hit = cache.get_json(cache.KEYWORDS_KEY)
        if hit is not None:
            return hit
    gainers = list((movers or {}).get("gainers") or [])
    losers = list((movers or {}).get("losers") or [])
    rows = gainers + losers
    if not rows:
        return []
    gemini = _gemini()
    if gemini is None:
        return []

    news: list = []
    client = _news()
    if client is not None:
        for m in gainers[:KEYWORD_NEWS_STOCKS] + losers[:KEYWORD_NEWS_STOCKS]:
            q, sort = theme_query(m.get("stock_name") or m.get("ticker"))
            try:
                news.extend(client.search(q, display=NEWS_PER_STOCK, sort=sort))
            except Exception as exc:  # noqa: BLE001
                log.warning("테마 뉴스 조회 실패(%s)", type(exc).__name__)

    resp = gemini.generate_json(prompts.hot_keywords_prompt(rows, news), HotKeywordsResponse,
                                system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return []
    known = {m.get("ticker") for m in rows}
    out = []
    for k in resp.keywords[:TOP_N]:
        tickers = [t for t in (norm_ticker(x) for x in k.tickers) if t in known]  # 목록 밖 코드는 버린다
        out.append({"keyword": k.keyword, "background": k.background, "tickers": tickers})
    cache.put_json(cache.KEYWORDS_KEY, out, cache.KEYWORDS_TTL)
    return out


def get_cached() -> dict:
    """API 용 — movers 캐시 + keywords 캐시를 계약 모양으로. 없으면 빈 모양."""
    movers = cache.get_json(cache.MOVERS_KEY) or {}
    return {
        "updated_at": movers.get("updated_at"),
        "gainers": movers.get("gainers") or [],
        "losers": movers.get("losers") or [],
        "keywords": cache.get_json(cache.KEYWORDS_KEY) or [],
    }

"""실시간 급등·급락 종목 + AI 원인 분석 + 핫 키워드 — KIS 등락률 순위 → (원인: Gemini 1회) → Redis.

⚠️ 네이버 검색 API 약관 개정(2026-09-07 시행, docs/naver-search-api-terms-issue.md)으로 뉴스를 LLM 에 넣지 않는다.
원인 분석·핫 키워드는 뉴스가 사실상 유일한 근거였으므로 **기본 꺼짐**(`MOVER_REASONS_ENABLED`·`HOT_KEYWORDS_ENABLED`).
꺼져 있으면 시세 목록만 캐시하고, 옛 캐시에 남은 원인·근거 기사·키워드도 응답에서 뺀다. 켜더라도 뉴스 없이 시세만 넣는다.

- 20종목(상승 10 + 하락 10)을 Gemini 한 번으로 묶는다(`MoverReasonsResponse`). 응답은 ticker 로 매칭, 빠진 종목은 원인 None.
- KIS 실패(또는 두 목록 모두 빈 결과)면 이전 캐시를 덮지 않는다.
- Gemini 가 없으면 원인 None 인 목록이라도 캐시한다(시세 목록 자체는 유효).

주기가 둘이다 — 순위만 2분(`refresh_list`, KIS 만), 원인까지 10분(`analyze`, KIS·Gemini). 잠금이 달라 동시에 돌 수 있어
두 경로 모두 `_save_movers` 하나로 저장하고, 어느 쪽이 나중에 써도 결과가 같도록 기준을 정했다:
- 목록: updated_at 이 더 새로운 KIS 스냅샷이 이긴다(Gemini 를 기다린 10분 분석이 더 새로운 2분 목록을 되돌리지 않게).
- 원인: 언제나 쓰기 직전에 읽은 `MOVERS_REASONS_KEY` 에서 ticker·방향이 모두 같을 때만 붙인다.
  이전 movers 본문에서 복사하지 않는다 — 옛 본문을 읽은 2분 회차가 새 원인을 덮으면 그 뒤 회차들이 옛 원인을 계속 물려받는다.
"""
from __future__ import annotations

import logging
from datetime import datetime, time

from apps.ai_analyst import cache, prompts
from apps.ai_analyst.clients.gemini_client import get_gemini_client
from apps.ai_analyst.schemas import HotKeywordsResponse, MarketMoversResponse, Mover, MoverReasonsResponse
from apps.collector.intraday_indices import KST
from apps.collector.kis.ranking import fetch_fluctuation
from shared import market_calendar

log = logging.getLogger(__name__)

TOP_N = 10
# 뉴스 없이는 근거가 없어 기본 꺼짐. 켜도 뉴스는 넣지 않는다(시세만 → '추정' 문구·신뢰도 하)
MOVER_REASONS_ENABLED = False
HOT_KEYWORDS_ENABLED = False
SESSION_START = time(9, 10)
SESSION_END = time(15, 30)
REASON_FIELDS = ("reason_summary", "category", "reliability", "risk_warning")


# ---------------------------------------------------------------- 외부 의존(테스트에서 바꿔 끼운다)
def _gemini():
    return get_gemini_client()


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
        # 방향 재확인(하락 정렬 "1" 은 2026-11-02 실호출로 확인했지만 방어로 둔다)
        if (up and rate <= 0) or (not up and rate >= 0):
            continue
        out.append(r)
    # KIS 응답 순서가 등락률 순이 아니었다(2026-11-02: 1위 +17.99%, 2위 +21.09%) → 직접 정렬 후 자른다
    out.sort(key=lambda r: r["change_rate"], reverse=up)
    return out[:TOP_N]


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


def _to_mover(r: dict, reason: dict | None) -> dict:
    m = Mover(ticker=r["ticker"], stock_name=r.get("name") or r["ticker"], price=r.get("price"),
              change_rate=r["change_rate"])
    if reason is not None:
        m = m.model_copy(update={f: reason.get(f) for f in REASON_FIELDS})
    return m.model_dump()  # sources 는 언제나 [] — 뉴스 근거 기사를 저장·응답하지 않는다


def _reasons(gemini, gainers, losers) -> dict:
    """Gemini 1회 → {ticker: MoverReasonItem}. Gemini 없거나 실패면 {}."""
    if gemini is None:
        return {}
    resp = gemini.generate_json(prompts.movers_prompt(gainers, losers), MoverReasonsResponse,
                                system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return {}
    return {norm_ticker(it.ticker): it for it in resp.items}


# ---------------------------------------------------------------- 저장(두 주기 공통 — 병합 기준은 모듈 설명)
def _kst(now: datetime) -> datetime:
    return now.replace(tzinfo=KST) if now.tzinfo is None else now.astimezone(KST)


def _load_reasons(day: str) -> dict:
    """오늘 원인만 {ticker: {side, 원인 필드}}. 어제 원인이 오늘 첫 회차 종목에 붙지 않게 날짜를 확인한다.

    원인 분석이 꺼져 있으면 {} — 끄기 전에 쌓인(뉴스 기반) 원인이 2분 회차마다 다시 붙지 않게."""
    if not MOVER_REASONS_ENABLED:
        return {}
    raw = cache.get_json(cache.MOVERS_REASONS_KEY)
    if not isinstance(raw, dict) or raw.get("date") != day or not isinstance(raw.get("items"), dict):
        return {}
    return raw["items"]


def _save_reasons(now_kst: datetime, gainers: list[dict], losers: list[dict], reasons: dict) -> None:
    """새 원인을 같은 날 원인에 덮어 합친다. Gemini 가 빠뜨린 종목은 직전 원인 유지, 실패({})면 아무것도 바꾸지 않는다.

    근거 기사(sources)는 저장하지 않는다(뉴스를 넣지 않음)."""
    if not reasons:
        return
    day = now_kst.date().isoformat()
    items = _load_reasons(day)
    for side, rows in (("up", gainers), ("down", losers)):
        for r in rows:
            it = reasons.get(r["ticker"])
            if it is not None:
                items[r["ticker"]] = {"side": side, **{f: getattr(it, f) for f in REASON_FIELDS}}
    cache.put_json(cache.MOVERS_REASONS_KEY, {"date": day, "items": items}, cache.MOVERS_REASONS_TTL)


def _attach(rows: list[dict], reasons: dict, side: str) -> list[dict]:
    """방향까지 같을 때만 원인을 붙인다 — 오전에 급등했다 오후에 급락한 종목에 급등 원인이 붙지 않게."""
    out = []
    for r in rows:
        reason = reasons.get(r["ticker"])
        out.append(_to_mover(r, reason if isinstance(reason, dict) and reason.get("side") == side else None))
    return out


def _is_newer(updated_at, now_kst: datetime) -> bool:
    """캐시의 updated_at 이 내 스냅샷(초 단위)보다 뒤인가. 같으면 False — 내 것을 쓴다. 형식이 깨졌으면 False."""
    try:
        return _kst(datetime.fromisoformat(updated_at)) > now_kst.replace(microsecond=0)
    except (TypeError, ValueError):
        return False


def _cached_rows(movers: list[dict]) -> list[dict]:
    return [{"ticker": m["ticker"], "name": m.get("stock_name"), "price": m.get("price"),
             "change_rate": m["change_rate"]} for m in movers]


def _save_movers(now: datetime, gainers: list[dict], losers: list[dict]) -> dict:
    """목록 + 오늘 원인 → today·last 저장(읽고 쓰는 사이는 원자적이지 않다 — 어긋나도 다음 2분 회차에 바로잡힌다)."""
    now_kst = _kst(now)
    updated_at = now_kst.isoformat(timespec="seconds")
    current = cache.get_json(cache.MOVERS_KEY)
    if isinstance(current, dict) and _is_newer(current.get("updated_at"), now_kst):
        updated_at = current["updated_at"]
        gainers = _cached_rows(current.get("gainers") or [])
        losers = _cached_rows(current.get("losers") or [])
    reasons = _load_reasons(now_kst.date().isoformat())
    body = MarketMoversResponse(
        updated_at=updated_at,
        gainers=_attach(gainers, reasons, "up"),
        losers=_attach(losers, reasons, "down"),
    ).model_dump(exclude={"keywords"})
    cache.put_json(cache.MOVERS_KEY, body, cache.MOVERS_TTL)
    cache.put_json(cache.MOVERS_LAST_KEY, body, cache.LAST_TTL)
    return body


def _fetch_snapshot(kis_client, session) -> tuple[list[dict], list[dict], str | None]:
    """(상승, 하락, 건너뛸 사유). 사유가 있으면 캐시를 건드리지 말 것 — PG·KIS 장애나 빈 결과로 이전 캐시를 덮지 않는다."""
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
        return [], [], "universe_error"
    if not universe:
        return [], [], "empty_universe"

    try:
        gainers, losers = fetch_movers(kis_client, universe=universe)
    except Exception as exc:  # noqa: BLE001 — KIS 실패면 이전 캐시를 그대로 둔다
        log.warning("등락률 순위 조회 실패(%s) — 이전 캐시 유지", type(exc).__name__)
        return [], [], "kis_error"
    if not gainers and not losers:
        return [], [], "no_movers"
    return gainers, losers, None


# ---------------------------------------------------------------- 진입점
def refresh_list(now: datetime, *, kis_client, session=None) -> dict:
    """순위만 갱신(2분 주기) — KIS 만 부른다. Gemini·핫 키워드는 부르지 않는다. 건너뛰면 {"skipped": 사유}."""
    gainers, losers, skipped = _fetch_snapshot(kis_client, session)
    if skipped:
        return {"skipped": skipped}
    return _save_movers(now, gainers, losers)


def analyze(now: datetime, *, kis_client, session=None, force: bool = False) -> dict:
    """급등락 원인 분석 → 캐시. 반환은 API 계약 모양 dict, 건너뛰면 {"skipped": 사유}.

    session: 유니버스 조회에 쓸 동기 세션(없으면 SyncSessionLocal 을 직접 연다).
    """
    if not force:
        hit = cache.get_json(cache.MOVERS_KEY)
        if hit:
            return {**hit, "gainers": _public(hit.get("gainers")), "losers": _public(hit.get("losers")),
                    "keywords": _cached_keywords(cache.KEYWORDS_KEY) or []}

    gainers, losers, skipped = _fetch_snapshot(kis_client, session)
    if skipped:
        return {"skipped": skipped}

    gemini = _gemini() if MOVER_REASONS_ENABLED else None  # 꺼져 있으면 Gemini 를 부르지 않는다
    reasons = _reasons(gemini, gainers, losers)

    _save_reasons(_kst(now), gainers, losers, reasons)  # 원인을 먼저 — 곧이어 도는 2분 회차도 새 원인을 읽는다
    body = _save_movers(now, gainers, losers)
    return {**body, "keywords": _cached_keywords(cache.KEYWORDS_KEY) or []}


def hot_keywords(movers: dict, *, force: bool = False) -> list[dict]:
    """핫 키워드 — 캐시가 있으면 그대로, 없으면 movers 목록만으로 Gemini 1회 → 캐시.

    기본 꺼짐(HOT_KEYWORDS_ENABLED) — 뉴스 제목이 유일한 근거였다. 꺼져 있으면 Gemini 없이 [](캐시도 건드리지 않는다).
    Gemini 가 없거나 실패하면 [] 를 반환하되 캐시하지 않는다(키를 넣은 뒤 30분 동안 빈 값이 나오지 않게).
    """
    if not HOT_KEYWORDS_ENABLED:
        return []
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

    resp = gemini.generate_json(prompts.hot_keywords_prompt(rows), HotKeywordsResponse,
                                system=prompts.SYSTEM_PROMPT)
    if resp is None:
        return []
    known = {m.get("ticker") for m in rows}
    out = []
    for k in resp.keywords[:TOP_N]:
        tickers = [t for t in (norm_ticker(x) for x in k.tickers) if t in known]  # 목록 밖 코드는 버린다
        out.append({"keyword": k.keyword, "background": k.background, "tickers": tickers})
    cache.put_json(cache.KEYWORDS_KEY, out, cache.KEYWORDS_TTL)
    cache.put_json(cache.KEYWORDS_LAST_KEY, out, cache.LAST_TTL)
    return out


def _public(movers) -> list[dict]:
    """응답용 — 근거 기사는 언제나 [](옛 캐시에 남은 네이버 뉴스 링크 포함). 원인 분석이 꺼져 있으면 옛 원인도 None."""
    out = []
    for m in movers or []:
        if isinstance(m, dict):
            m = {**m, "sources": []}
            if not MOVER_REASONS_ENABLED:
                m.update({f: None for f in REASON_FIELDS})
        out.append(m)
    return out


def _cached_keywords(key: str):
    """핫 키워드가 꺼져 있으면 None — 끄기 전 캐시(뉴스 기반 배경 문장)가 last 폴백으로 4일간 나오지 않게."""
    return cache.get_json(key) if HOT_KEYWORDS_ENABLED else None


def get_cached() -> dict:
    """API 용 — movers 캐시 + keywords 캐시를 계약 모양으로. 없으면 빈 모양.

    today 캐시가 만료됐으면(장 마감 뒤·개장 전) 마지막 성공 결과(last)로 폴백한다 — 화면은 updated_at 으로 시점을 보여 준다.
    movers·keywords 는 TTL 이 달라 각각 따로 폴백한다.
    """
    movers = cache.get_json(cache.MOVERS_KEY) or cache.get_json(cache.MOVERS_LAST_KEY) or {}
    keywords = _cached_keywords(cache.KEYWORDS_KEY)
    if keywords is None:
        keywords = _cached_keywords(cache.KEYWORDS_LAST_KEY)
    return {
        "updated_at": movers.get("updated_at"),
        "gainers": _public(movers.get("gainers")),
        "losers": _public(movers.get("losers")),
        "keywords": keywords or [],
    }

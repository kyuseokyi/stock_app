"""당일 1분봉 KIS 보충 — game_ws 시작·시즌 종목 전환 시 1회(source='kis').

KIS 주식당일분봉조회(inquire-time-itemchartprice, FHKST03010200)는 FID_INPUT_HOUR_1 이하 최신 30건을
최신→과거 순으로 준다 → 가장 이른 분 - 1분으로 역순 페이지네이션해 09:00 까지 모은다.
- 시장: 첫 페이지를 UN(통합)으로, 오늘 행이 없으면 J(KRX)로 정하고 이후 페이지는 같은 시장(CLAUDE.md 규칙).
- 넣는 분: 09:00 이후 · 거래창(TRADING_WINDOWS) 안 · 현재(진행 중) 분과 첫 틱 분 미만 ·
  이미 source='tick' 행이 없는 분(tick 행을 kis 로 덮지 않게).
- 주말·09:00 이전은 건너뜀, 휴장일은 오늘 날짜 행이 없어 자연히 0건. 실패는 로그만.
"""
from __future__ import annotations

import logging
import time as _time
from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone

from apps.collector.game_ws.minute_bars import Bar, insert_bars

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
OPEN = time(9, 0)
MAX_PAGES = 30
PAGE_PAUSE_SEC = 0.5  # 모의(vps) 초당 호출 제한 여유

FetchPage = Callable[[str, str], list[dict]]  # (hour HHMMSS, market) -> output2


def parse_rows(rows: list[dict], day: date) -> list[Bar]:
    """output2 → Bar(분 시작 KST). 다른 날짜·빈 행은 건너뜀."""
    out: list[Bar] = []
    ymd = day.strftime("%Y%m%d")
    for r in rows:
        hhmmss = r.get("stck_cntg_hour") or ""
        if r.get("stck_bsop_date") != ymd or len(hhmmss) < 4 or not r.get("stck_prpr"):
            continue
        try:
            ts = datetime(day.year, day.month, day.day, int(hhmmss[0:2]), int(hhmmss[2:4]), tzinfo=KST)
            close = float(r["stck_prpr"])
            out.append(Bar(
                ticker="", ts=ts,
                open=float(r.get("stck_oprc") or close), high=float(r.get("stck_hgpr") or close),
                low=float(r.get("stck_lwpr") or close), close=close,
                volume=int(r.get("cntg_vol") or 0),
            ))
        except (ValueError, TypeError):
            continue
    return out


def fetch_today_bars(fetch_page: FetchPage, now: datetime, pause: float = PAGE_PAUSE_SEC) -> list[Bar]:
    """오늘 09:00 ~ now 분봉(중복 제거). UN 첫 페이지가 비면 J."""
    day = now.date()
    hour = now.strftime("%H%M%S")
    market = "UN"
    bars = parse_rows(fetch_page(hour, market), day)
    if not bars:
        market = "J"  # NXT 미상장 종목은 UN 빈 응답
        bars = parse_rows(fetch_page(hour, market), day)
    got: dict[datetime, Bar] = {}
    for _ in range(MAX_PAGES):
        if not bars:
            break
        for b in bars:
            got.setdefault(b.ts, b)
        oldest = min(b.ts for b in bars)
        if oldest.time() <= OPEN:
            break
        nxt = (oldest - timedelta(minutes=1)).strftime("%H%M%S")
        if nxt >= hour:  # 진행 없음(같은 페이지 반복) 방지
            break
        hour = nxt
        if pause:
            _time.sleep(pause)
        bars = parse_rows(fetch_page(hour, market), day)
    log.info("KIS 당일분봉 수집: market=%s bars=%d", market, len(got))
    return [got[k] for k in sorted(got)]


def _in_windows(ts: datetime, windows) -> bool:
    t = ts.timetz().replace(tzinfo=None)
    return any(s <= t <= e for s, e in windows)


def select_backfill(
    bars: list[Bar], now: datetime, first_tick_minute: datetime | None,
    tick_minutes: set[datetime], windows,
) -> list[Bar]:
    """보충 대상만 — 09:00 이후·거래창 안·현재 분/첫 틱 분 미만·tick 행 없음."""
    upper = now.astimezone(KST).replace(second=0, microsecond=0)
    if first_tick_minute is not None:
        ft = first_tick_minute.astimezone(KST)
        if ft.date() == upper.date() and ft < upper:
            upper = ft
    return [
        b for b in bars
        if b.ts.time() >= OPEN and b.ts < upper and _in_windows(b.ts, windows) and b.ts not in tick_minutes
    ]


def tick_minutes_in_ch(ticker: str, day: date, client=None, db: str | None = None) -> set[datetime]:
    """오늘 이미 source='tick' 인 분(FINAL 기준)."""
    from shared.clickhouse_schema import CLICKHOUSE_DB, get_client

    rows = (client or get_client()).query(
        f"SELECT toUnixTimestamp(ts) FROM {db or CLICKHOUSE_DB}.game_minute_bars FINAL "
        "WHERE ticker = %(t)s AND toDate(ts) = %(d)s AND source = 'tick'",
        parameters={"t": ticker, "d": day.isoformat()},
    ).result_rows
    return {datetime.fromtimestamp(int(r[0]), KST) for r in rows}


def backfill_today(
    ticker: str, *,
    fetch_page: FetchPage,
    insert: Callable[[list[Bar], str], None],
    tick_minutes: Callable[[str, date], set[datetime]],
    first_tick_minute: Callable[[], datetime | None],
    now: datetime | None = None,
    windows=None,
    pause: float = PAGE_PAUSE_SEC,
) -> int:
    """보충 실행 — 넣은 분 수 반환. 주말·09:00 이전은 0."""
    from apps.trading_game.services import market_clock

    now = (now or datetime.now(KST)).astimezone(KST)
    if now.weekday() >= 5 or now.time() < OPEN:
        return 0
    bars = fetch_today_bars(fetch_page, now, pause=pause)
    if not bars:
        return 0
    # 첫 틱·tick 행은 수집 직후(=insert 직전)에 판정
    sel = select_backfill(
        bars, now, first_tick_minute(), tick_minutes(ticker, now.date()),
        windows if windows is not None else market_clock.load_windows(),
    )
    for b in sel:
        b.ticker = ticker
    if sel:
        insert(sel, "kis")
    return len(sel)


def run_backfill(ticker: str, first_tick_minute: Callable[[], datetime | None]) -> int:
    """game_ws 용 실 KIS·CH 래퍼(스레드에서 호출). 어떤 실패도 올리지 않는다."""
    try:
        from apps.collector.kis.client import KISClient
        from shared.clickhouse_schema import ensure_game_minute_bars

        client = KISClient()
        ensure_game_minute_bars()
        n = backfill_today(
            ticker,
            fetch_page=lambda hour, market: client.get_today_minute_bars(ticker, hour, market),
            insert=insert_bars,
            tick_minutes=tick_minutes_in_ch,
            first_tick_minute=first_tick_minute,
        )
        log.info("KIS 당일분봉 보충: ticker=%s inserted=%d", ticker, n)
        return n
    except Exception as e:  # noqa: BLE001 — 보충 실패는 게임 동작 무관
        log.warning("KIS 당일분봉 보충 실패(무시): ticker=%s err=%s", ticker, e)
        return 0

"""관리자 데이터 현황 — 데이터별 최신일·건수·상태, 설정 상태(값은 절대 반환하지 않음), 최근 일일 파이프라인.

지연은 달력이 아니라 daily_prices 최신 거래일(ref)과 비교한다 → 휴장일 달력이 필요 없다.
주기가 다른 데이터(재무 주 1회·FRED 월간·공모주)는 오늘 기준 일수로 따로 판정한다.
전체 count() FINAL 은 쓰지 않는다(최신일 + 그날 종목 수만). 조회 하나가 실패해도 그 항목만 error.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Callable

from sqlalchemy import func, select

from apps.collector import fred
from apps.collector.market_indices import index_specs
from apps.collector.tasks.canslim import q_cumulative_setting
from shared import pipeline_record
from shared.clickhouse_schema import CLICKHOUSE_DB as DB
from shared.clickhouse_schema import get_client
from shared.database import SyncSessionLocal
from shared.market_models import StockEvent
from shared.sync_redis import get_sync_redis

log = logging.getLogger(__name__)

_EPOCH = date(1970, 1, 1)
DAILY_DROP_WARN = 0.10       # 전 거래일보다 종목 수가 10% 넘게 줄면 주의
US_STALE_DAYS = 4            # 미국은 시차·휴장 허용
FUNDAMENTALS_STALE_DAYS = 8  # 매주 토요일 수집
MACRO_STALE_DAYS = 45        # 월간 지표
IPO_STALE_DAYS = 3
IPO_AHEAD_DAYS = 60
LATE = "최신 거래일보다 늦어요"


# ---------------------------------------------------------------- 저장소 접근(테스트에서 바꿔 끼운다)
def _ch():
    return get_client()


def _query(sql: str, params: dict | None = None) -> list:
    return _ch().query(sql, parameters=params or {}).result_rows


def _today() -> date:
    return date.today()


def _ipo_stats(today: date) -> tuple[datetime | None, int]:
    """(KIS 공모주 일정 마지막 갱신 시각, 앞으로 IPO_AHEAD_DAYS 일 일정 수)."""
    with SyncSessionLocal() as db:
        last = db.execute(select(func.max(StockEvent.updated_at)).where(StockEvent.source == "kis")).scalar()
        upcoming = db.execute(
            select(func.count()).select_from(StockEvent).where(
                StockEvent.source == "kis", StockEvent.event_date >= today,
                StockEvent.event_date <= today + timedelta(days=IPO_AHEAD_DAYS))
        ).scalar()
    return last, int(upcoming or 0)


# ---------------------------------------------------------------- 도우미
def _day(v) -> date | None:
    """CH 의 빈 max() 는 NULL 이 아니라 1970-01-01 이다 → None."""
    if v is None:
        return None
    d = v.date() if isinstance(v, datetime) else v
    return None if d <= _EPOCH else d


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _item(key: str, label: str, latest: date | None = None, count: int | None = None, unit: str = "",
          status: str = "ok", note: str = "", items: list | None = None) -> dict:
    out = {"key": key, "label": label, "latest": _iso(latest), "count": count, "unit": unit,
           "status": status, "note": note}
    if items is not None:
        out["items"] = items
    return out


# ---------------------------------------------------------------- 데이터별
def _daily(ref: date | None) -> dict:
    if ref is None:
        return _item("daily", "일봉", unit="종목", status="empty", note="일봉 데이터가 없어요")
    rows = _query(f"SELECT date, uniqExact(ticker) FROM {DB}.daily_prices "
                  "WHERE date > %(since)s AND date <= %(d)s GROUP BY date ORDER BY date DESC LIMIT 2",
                  {"since": ref - timedelta(days=14), "d": ref})
    cur = int(rows[0][1]) if rows else 0
    prev = int(rows[1][1]) if len(rows) > 1 else None
    if prev and cur < prev * (1 - DAILY_DROP_WARN):
        drop = round((1 - cur / prev) * 100)
        return _item("daily", "일봉", ref, cur, "종목", "warn", f"전 거래일({prev:,}종목)보다 {drop}% 적어요")
    return _item("daily", "일봉", ref, cur, "종목", note=f"전 거래일 {prev:,}종목" if prev else "")


def _indices(region: str, ref: date | None) -> dict:
    key, label = ("indices_kr", "국내 지수") if region == "KR" else ("indices_us", "미국 지수·환율·대표 종목")
    specs = index_specs(region)
    rows = _query(f"SELECT code, max(date) FROM {DB}.market_index_daily WHERE code IN %(codes)s GROUP BY code",
                  {"codes": [s.code for s in specs]})
    found = {code: _day(d) for code, d in rows}
    items = []
    for s in specs:
        d = found.get(s.code)
        if region == "KR":
            late = d is None or (ref is not None and d < ref)
        else:
            late = d is None or (ref is not None and (ref - d).days > US_STALE_DAYS)
        items.append({"code": s.code, "name": s.name, "latest": _iso(d), "status": "stale" if late else "ok"})
    dates = [d for d in found.values() if d]
    if not dates:
        return _item(key, label, None, len(specs), "코드", "empty", "수집된 지수가 없어요", items)
    n_late = sum(i["status"] == "stale" for i in items)
    return _item(key, label, max(dates), len(specs), "코드", "stale" if n_late else "ok",
                 f"{n_late}개 코드가 늦어요" if n_late else "", items)


def _latest(table: str, key: str, label: str, ref: date | None) -> dict:
    rows = _query(f"SELECT date, uniqExact(ticker) FROM {DB}.{table} "
                  f"WHERE date = (SELECT max(date) FROM {DB}.{table}) GROUP BY date")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item(key, label, unit="종목", status="empty", note="데이터가 없어요")
    late = ref is not None and d < ref
    return _item(key, label, d, int(rows[0][1]), "종목", "stale" if late else "ok", LATE if late else "")


def _market_groups(ref: date | None) -> dict:
    rows = _query(f"SELECT date, kind, uniqExact(group_id) FROM {DB}.market_group_daily FINAL "
                  f"WHERE date = (SELECT max(date) FROM {DB}.market_group_daily WHERE members > 0) "
                  f"AND members > 0 GROUP BY date, kind")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item("market_groups", "시장 그룹(테마·업종)", unit="그룹", status="empty", note="데이터가 없어요")
    by_kind = {kind: int(n) for _, kind, n in rows}
    late = ref is not None and d < ref
    note = f"테마 {by_kind.get('theme', 0)} · 업종 {by_kind.get('sector', 0)}" + (f" · {LATE}" if late else "")
    return _item("market_groups", "시장 그룹(테마·업종)", d, sum(by_kind.values()), "그룹",
                 "stale" if late else "ok", note)


def _fundamentals(today: date) -> dict:
    rows = _query(f"SELECT max(ingested_at), uniqExact(ticker) FROM {DB}.fundamentals_periodic")
    d = _day(rows[0][0]) if rows else None
    if d is None:
        return _item("fundamentals", "재무(분기·연간)", unit="종목", status="empty", note="데이터가 없어요")
    late = (today - d).days > FUNDAMENTALS_STALE_DAYS
    note = f"{FUNDAMENTALS_STALE_DAYS}일 넘게 수집되지 않았어요(매주 토요일 수집)" if late else "매주 토요일 수집"
    return _item("fundamentals", "재무(분기·연간)", d, int(rows[0][1]), "종목", "stale" if late else "ok", note)


def _macro(today: date) -> dict:
    ids = fred.series_ids()
    if fred.api_key() is None:
        return _item("macro", "FRED 거시 지표", None, len(ids), "시리즈", "off", "FRED_API_KEY 가 없어 수집하지 않아요")
    rows = _query(f"SELECT series_id, max(date) FROM {DB}.macro_series WHERE series_id IN %(ids)s "
                  "GROUP BY series_id", {"ids": ids})
    found = {sid: _day(d) for sid, d in rows}
    items = []
    for sid in ids:
        d = found.get(sid)
        late = d is None or (today - d).days > MACRO_STALE_DAYS
        items.append({"code": sid, "latest": _iso(d), "status": "stale" if late else "ok"})
    dates = [d for d in found.values() if d]
    if not dates:
        return _item("macro", "FRED 거시 지표", None, len(ids), "시리즈", "empty", "수집된 시리즈가 없어요", items)
    n_late = sum(i["status"] == "stale" for i in items)
    note = f"{n_late}개 시리즈가 {MACRO_STALE_DAYS}일 넘게 갱신되지 않았어요" if n_late else ""
    return _item("macro", "FRED 거시 지표", max(dates), len(ids), "시리즈", "stale" if n_late else "ok", note, items)


def _ipo(today: date) -> dict:
    last, upcoming = _ipo_stats(today)
    d = _day(last)
    if d is None:
        return _item("ipo", "공모주 일정", unit="건", status="empty", note="수집된 일정이 없어요")
    late = (today - d).days > IPO_STALE_DAYS
    note = f"앞으로 {IPO_AHEAD_DAYS}일 일정 {upcoming}건" + (f" · {IPO_STALE_DAYS}일 넘게 갱신되지 않았어요" if late else "")
    return _item("ipo", "공모주 일정", d, upcoming, "건", "stale" if late else "ok", note)


def _safe(key: str, label: str, fn: Callable[[], dict]) -> dict:
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 — 한 항목 실패가 화면 전체를 막지 않게
        log.warning("데이터 현황 조회 실패 %s: %s", key, exc)
        return _item(key, label, status="error", note="조회에 실패했어요(서버 로그 확인)")


def _settings() -> dict:
    """설정 '여부'만 — 값 자체는 절대 내보내지 않는다."""
    try:
        q = q_cumulative_setting()
        return {"fred_key": fred.api_key() is not None,
                "q_cumulative": "unset" if q is None else ("true" if q else "false")}
    except Exception as exc:  # noqa: BLE001
        log.warning("설정 상태 조회 실패: %s", exc)
        return {"fred_key": False, "q_cumulative": "unset"}


def _pipeline() -> dict | None:
    try:
        return pipeline_record.load(get_sync_redis())
    except Exception as exc:  # noqa: BLE001 — 기록을 못 읽어도 현황 화면은 보여준다
        log.warning("파이프라인 기록 읽기 실패: %s", exc)
        return None


def build_status() -> dict:
    today = _today()
    ref, ref_failed = None, False
    try:
        rows = _query(f"SELECT max(date) FROM {DB}.daily_prices")
        ref = _day(rows[0][0]) if rows else None
    except Exception as exc:  # noqa: BLE001
        log.warning("기준 거래일 조회 실패: %s", exc)
        ref_failed = True

    def daily() -> dict:
        if ref_failed:
            raise RuntimeError("기준 거래일 조회 실패")
        return _daily(ref)

    datasets = [
        _safe("daily", "일봉", daily),
        _safe("indices_kr", "국내 지수", lambda: _indices("KR", ref)),
        _safe("indices_us", "미국 지수·환율·대표 종목", lambda: _indices("US", ref)),
        _safe("investor", "투자자 순매수", lambda: _latest("investor_daily", "investor", "투자자 순매수", ref)),
        _safe("fundamentals", "재무(분기·연간)", lambda: _fundamentals(today)),
        _safe("macro", "FRED 거시 지표", lambda: _macro(today)),
        _safe("ipo", "공모주 일정", lambda: _ipo(today)),
        _safe("canslim", "CANSLIM", lambda: _latest("canslim_daily", "canslim", "CANSLIM", ref)),
        _safe("market_groups", "시장 그룹(테마·업종)", lambda: _market_groups(ref)),
    ]
    return {"ref_date": _iso(ref), "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "datasets": datasets, "settings": _settings(), "pipeline": _pipeline()}

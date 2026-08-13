"""stock_meta(국내 종목 마스터) 공용 리포지토리 — 동기 세션.

단일 출처(Single Source of Truth)로서 collector(쓰기·수집대상)와 stock_api(검색·차트해석)가
공유한다. stock_api도 ClickHouse를 동기(clickhouse_connect)로 접근하므로 동기 세션으로 통일한다.

- sync_master     : .mst 종목 upsert(active) + 사라진 종목 is_active=false (멱등)
- list_active     : 수집 대상 티커 목록 (collector)
- search_active   : 이름/코드 부분일치 검색 (stock_api searchStocks)
- get_active      : 단건 조회 (stock_api 차트 종목해석)
"""

from __future__ import annotations

from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from shared.models import MarketType, StockMeta


def sync_master(session: Session, rows: list[tuple[str, str, str]]) -> dict:
    """(ticker, name, market) 목록으로 stock_meta 동기화.

    한 트랜잭션에서 전체 비활성화 → 현재분 upsert(active) → commit.
    조회자는 원자적 최종 상태만 본다. 멱등.
    """
    # 티커 기준 중복 제거(.mst에 동일 6자리 코드가 중복될 수 있음 — ON CONFLICT는
    # 한 INSERT에서 같은 키를 두 번 못 다룸). 나중 항목이 우선.
    by_ticker: dict[str, dict] = {}
    for ticker, name, market in rows:
        try:
            mt = MarketType(market)
        except ValueError:
            continue  # 알 수 없는 시장코드는 스킵
        by_ticker[ticker] = {"ticker": ticker, "name": name, "market": mt, "is_active": True}
    values = list(by_ticker.values())

    if not values:
        return {"upserted": 0, "active_total": 0, "inactive_total": 0}

    # 1) 전체 비활성화 (없어진 종목 = 상폐 처리, 트랜잭션 내라 원자적)
    session.execute(update(StockMeta).values(is_active=False))

    # 2) 현재 .mst 종목 upsert → is_active=true
    stmt = pg_insert(StockMeta).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[StockMeta.ticker],
        set_={
            "name": stmt.excluded.name,
            "market": stmt.excluded.market,
            "is_active": True,
            "updated_at": func.now(),
        },
    )
    session.execute(stmt)
    session.commit()

    active_total = session.scalar(
        select(func.count()).select_from(StockMeta).where(StockMeta.is_active.is_(True))
    )
    inactive_total = session.scalar(
        select(func.count()).select_from(StockMeta).where(StockMeta.is_active.is_(False))
    )
    return {
        "upserted": len(values),
        "active_total": int(active_total or 0),
        "inactive_total": int(inactive_total or 0),
    }


def list_active(session: Session) -> list[tuple[str, str, str]]:
    """활성 국내 종목 (ticker, name, market) 목록 — 수집 대상."""
    rows = session.execute(
        select(StockMeta.ticker, StockMeta.name, StockMeta.market)
        .where(StockMeta.is_active.is_(True))
        .order_by(StockMeta.ticker)
    ).all()
    return [(t, n, m.value) for t, n, m in rows]


def search_active(session: Session, query: str, limit: int = 20) -> list[StockMeta]:
    """이름 또는 종목코드 부분일치 검색 (활성)."""
    like = f"%{query.strip()}%"
    return list(
        session.execute(
            select(StockMeta)
            .where(
                StockMeta.is_active.is_(True),
                or_(StockMeta.name.ilike(like), StockMeta.ticker.ilike(like)),
            )
            .order_by(StockMeta.ticker)
            .limit(limit)
        )
        .scalars()
        .all()
    )


def get_active(session: Session, ticker: str) -> StockMeta | None:
    """단건 조회 (활성)."""
    return session.execute(
        select(StockMeta).where(
            StockMeta.ticker == ticker, StockMeta.is_active.is_(True)
        )
    ).scalar_one_or_none()

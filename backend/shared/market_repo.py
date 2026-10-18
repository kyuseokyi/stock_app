"""시장 참조 데이터 동기 저장소(collector 용) — 프로필·업종·KIS 테마·분석 대상·일정."""
from __future__ import annotations

import logging
from dataclasses import asdict

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from shared.market_models import Sector, StockEvent, StockProfile, Theme, ThemeStock
from shared.models import StockMeta

log = logging.getLogger(__name__)
_CHUNK = 1000  # 한 INSERT 의 파라미터가 PG 상한(65535)을 넘지 않게


def _upsert(session: Session, model, values: list[dict], keys: list[str]) -> int:
    if not values:
        return 0
    ins = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    for i in range(0, len(values), _CHUNK):
        chunk = values[i:i + _CHUNK]
        stmt = ins(model).values(chunk)
        cols = [c for c in chunk[0] if c not in keys]
        stmt = stmt.on_conflict_do_update(index_elements=keys, set_={c: getattr(stmt.excluded, c) for c in cols})
        session.execute(stmt)
    session.commit()
    return len(values)


def sync_profiles(session: Session, profiles) -> int:
    """원천에 있는 종목만 upsert(없어진 종목은 남겨 둔다 — 상폐 여부는 stock_meta.is_active 가 판단)."""
    by_ticker = {p.ticker: asdict(p) for p in profiles}
    return _upsert(session, StockProfile, list(by_ticker.values()), ["ticker"])


def sync_sectors(session: Session, sectors: dict[str, str]) -> int:
    return _upsert(session, Sector, [{"code": c, "name": n} for c, n in sectors.items()], ["code"])


def analysis_universe(session: Session) -> list[tuple[str, str, str]]:
    """분석 대상 = 활성 stock_meta 중 보통주(ETP·SPAC·우선주 제외). 프로필이 아직 없으면 활성 전체."""
    has_profiles = session.scalar(select(StockProfile.ticker).limit(1)) is not None
    q = select(StockMeta.ticker, StockMeta.name, StockMeta.market).where(StockMeta.is_active.is_(True))
    if has_profiles:
        q = q.join(StockProfile, StockProfile.ticker == StockMeta.ticker).where(
            StockProfile.is_etp.is_(False), StockProfile.is_spac.is_(False), StockProfile.is_preferred.is_(False)
        )
    else:
        log.warning("stock_profile 비어 있음 — 분석 대상을 활성 종목 전체로")
    rows = session.execute(q.order_by(StockMeta.ticker)).all()
    return [(t, n, m.value if hasattr(m, "value") else str(m)) for t, n, m in rows]


def sync_kis_themes(session: Session, themes) -> dict:
    """KIS 테마 동기화 — source='kis' 연결만 추가·삭제. 관리자 행·숨김·제외 표시는 보존.

    마스터에서 사라진 KIS 테마는 지우지 않고 KIS 연결만 정리한다(관리자가 붙인 설명·종목 보존).
    """
    existing = {t.kis_code: t for t in session.scalars(select(Theme).where(Theme.kis_code.is_not(None)))}
    seen: set[str] = set()
    added = removed = 0
    for row in themes:
        seen.add(row.code)
        theme = existing.get(row.code)
        if theme is None:
            theme = Theme(kis_code=row.code, name=row.name, source="kis")
            session.add(theme)
            session.flush()
        elif theme.source == "kis" and theme.name != row.name:
            theme.name = row.name
        links = {s.ticker: s for s in session.scalars(select(ThemeStock).where(ThemeStock.theme_id == theme.id))}
        wanted = set(row.tickers)
        for ticker, link in links.items():
            if link.source == "kis" and ticker not in wanted:
                session.delete(link)
                removed += 1
        for ticker in row.tickers:
            if ticker not in links:
                session.add(ThemeStock(theme_id=theme.id, ticker=ticker, source="kis"))
                added += 1
    for code, theme in existing.items():
        if code not in seen:
            removed += session.execute(
                delete(ThemeStock).where(ThemeStock.theme_id == theme.id, ThemeStock.source == "kis")
            ).rowcount or 0
    session.commit()
    return {"themes": len(seen), "added": added, "removed": removed}


def upsert_events(session: Session, events: list[dict]) -> int:
    by_key = {e["source_key"]: e for e in events}
    return _upsert(session, StockEvent, list(by_key.values()), ["source_key"])


def names_for(session: Session, tickers: list[str]) -> dict[str, str]:
    if not tickers:
        return {}
    return dict(session.execute(select(StockMeta.ticker, StockMeta.name).where(StockMeta.ticker.in_(tickers))).all())

"""테마 관리자 보정(async) — KIS 테마 숨김·이름 수정, 관리자 테마 생성, 종목 추가·제외.

KIS 동기화(shared.market_repo.sync_kis_themes)는 source='kis' 연결만 건드리므로 여기서 바꾼 표시는 유지된다.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.market_models import Theme, ThemeStock


class ThemeNotFound(Exception):
    pass


async def _counts(db: AsyncSession) -> dict[int, int]:
    rows = await db.execute(
        select(ThemeStock.theme_id, func.count())
        .where(ThemeStock.is_excluded.is_(False))
        .group_by(ThemeStock.theme_id)
    )
    return dict(rows.all())


def _dto(t: Theme, count: int) -> dict:
    return {"id": t.id, "kis_code": t.kis_code, "name": t.name, "source": t.source, "is_hidden": t.is_hidden,
            "description": t.description, "stock_count": count}


async def _get(db: AsyncSession, theme_id: int) -> Theme:
    t = await db.get(Theme, theme_id)
    if t is None:
        raise ThemeNotFound(theme_id)
    return t


async def list_themes(db: AsyncSession) -> list[dict]:
    counts = await _counts(db)
    themes = (await db.execute(select(Theme).order_by(Theme.is_hidden, Theme.name))).scalars().all()
    return [_dto(t, counts.get(t.id, 0)) for t in themes]


async def create_theme(db: AsyncSession, name: str, description: str | None) -> dict:
    t = Theme(name=name.strip(), description=description, source="admin")
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _dto(t, 0)


async def update_theme(db: AsyncSession, theme_id: int, changes: dict) -> dict:
    t = await _get(db, theme_id)
    if changes.get("name") is not None:
        t.name = changes["name"].strip()
    if "description" in changes:
        t.description = changes["description"]
    if changes.get("is_hidden") is not None:
        t.is_hidden = bool(changes["is_hidden"])
    await db.commit()
    await db.refresh(t)
    return _dto(t, (await _counts(db)).get(t.id, 0))


async def list_stocks(db: AsyncSession, theme_id: int) -> list[dict]:
    await _get(db, theme_id)
    rows = (await db.execute(
        select(ThemeStock).where(ThemeStock.theme_id == theme_id).order_by(ThemeStock.ticker)
    )).scalars()
    return [{"ticker": s.ticker, "source": s.source, "is_excluded": s.is_excluded, "reason": s.reason} for s in rows]


async def add_stock(db: AsyncSession, theme_id: int, ticker: str, reason: str | None) -> None:
    """없으면 관리자 연결로 추가, 있으면(제외됐던 KIS 연결 포함) 제외만 해제 — 출처는 유지."""
    await _get(db, theme_id)
    link = await db.get(ThemeStock, (theme_id, ticker))
    if link is None:
        db.add(ThemeStock(theme_id=theme_id, ticker=ticker, source="admin", reason=reason))
    else:
        link.is_excluded = False
        if reason:
            link.reason = reason
    await db.commit()


async def exclude_stock(db: AsyncSession, theme_id: int, ticker: str) -> None:
    """지우지 않고 제외 표시 — 다음 KIS 동기화가 같은 종목을 다시 넣어도 화면에는 나오지 않게."""
    await _get(db, theme_id)
    link = await db.get(ThemeStock, (theme_id, ticker))
    if link is not None:
        link.is_excluded = True
        await db.commit()

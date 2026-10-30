"""AI 시황 분석 PG 저장소(동기 Session) — 모닝 브리핑·종목 정성 분석 upsert/조회.

PG 는 ON CONFLICT, sqlite(테스트)는 sqlite insert 의 on_conflict 로 같은 동작.
반환 dict 의 date·created_at 은 ISO 문자열.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from apps.ai_analyst.schemas import MorningBriefingResponse, ScreenerQualitativeResponse
from shared.ai_models import AiDailyBriefing, AiStockEvaluation

_BRIEF_FIELDS = ("headline", "us_market_summary", "kr_impact_summary", "bullish_sectors", "bearish_sectors",
                 "macro_checkpoints")
_EVAL_FIELDS = ("ticker", "hook_summary", "growth_quality", "financial_quality_note", "red_flag_level", "red_flags")


def _upsert(session: Session, model, values: dict, keys: list[str]) -> None:
    ins = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = ins(model).values(values)
    cols = [c for c in values if c not in keys]
    stmt = stmt.on_conflict_do_update(index_elements=keys, set_={c: getattr(stmt.excluded, c) for c in cols})
    session.execute(stmt)
    session.commit()


def _iso(v):
    return v.isoformat() if v is not None else None


def _row_dict(row, fields: tuple[str, ...]) -> dict:
    out = {f: getattr(row, f) for f in fields}
    out["date"] = _iso(row.date)
    out["created_at"] = _iso(row.created_at)
    return out


def upsert_briefing(session: Session, day: date, data: MorningBriefingResponse) -> None:
    values = {"date": day, **data.model_dump(include=set(_BRIEF_FIELDS))}
    _upsert(session, AiDailyBriefing, values, ["date"])


def get_briefing(session: Session, day: date) -> dict | None:
    """day 의 브리핑, 없으면 day 이전 가장 최근 1건."""
    row = session.scalars(
        select(AiDailyBriefing).where(AiDailyBriefing.date <= day).order_by(AiDailyBriefing.date.desc()).limit(1)
    ).first()
    return _row_dict(row, _BRIEF_FIELDS) if row else None


def upsert_evaluation(session: Session, day: date, data: ScreenerQualitativeResponse) -> None:
    values = {"date": day, **data.model_dump(include=set(_EVAL_FIELDS))}
    _upsert(session, AiStockEvaluation, values, ["ticker", "date"])


def get_latest_evaluation(session: Session, ticker: str) -> dict | None:
    row = session.scalars(
        select(AiStockEvaluation).where(AiStockEvaluation.ticker == ticker)
        .order_by(AiStockEvaluation.date.desc()).limit(1)
    ).first()
    if row is None:
        return None
    out = _row_dict(row, _EVAL_FIELDS)
    out["red_flags"] = out["red_flags"] or []
    return out


def evaluated_tickers(session: Session, day: date) -> set[str]:
    return set(session.scalars(select(AiStockEvaluation.ticker).where(AiStockEvaluation.date == day)).all())

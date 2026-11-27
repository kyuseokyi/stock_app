"""AI Lab 리포트 PG 저장소(동기 Session) — upsert·단건·목록(쪽 나누기)·일괄 분석 대상(급등 상위).

PG 는 ON CONFLICT, sqlite(테스트)는 sqlite insert 의 on_conflict 로 같은 동작(apps/ai_analyst/repository.py 와 같은 방식).
반환 dict 의 날짜·시각은 ISO 문자열.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from shared.ai_models import AdminAiSkillReport
from shared.daily_surge_models import DailySurgeStock

_KEYS = ("ticker", "as_of_date")
_JSON_COLS = ("quant_facts", "sepa_analysis", "vibe_backtest", "exposure_and_sizing", "logic_chain_and_thesis",
              "ev_scenarios", "k_dart_and_valuation", "dart_catalysts")


def _iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def report_out(row: AdminAiSkillReport) -> dict:
    out = {"id": row.id, "ticker": row.ticker, "stock_name": row.stock_name, "as_of_date": _iso(row.as_of_date)}
    out.update({c: getattr(row, c) for c in _JSON_COLS})
    out.update({"overall_verdict": row.overall_verdict, "executive_summary": row.executive_summary,
                "model_name": row.model_name, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)})
    return out


def summary_out(row: AdminAiSkillReport) -> dict:
    """목록 항목 — 요약 필드만(JSON 묶음 본문 제외)."""
    thesis = (row.logic_chain_and_thesis or {}).get("thesis") or {}
    lines = (row.executive_summary or "").splitlines()
    return {"id": row.id, "ticker": row.ticker, "stock_name": row.stock_name, "as_of_date": _iso(row.as_of_date),
            "overall_verdict": row.overall_verdict, "signal": thesis.get("signal"),
            "weighted_ev_pct": (row.ev_scenarios or {}).get("weighted_ev_pct"),
            "headline": lines[0] if lines else "", "model_name": row.model_name,
            "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at)}


def upsert(session: Session, values: dict) -> dict:
    """(ticker, as_of_date) 같으면 덮어쓰고 updated_at 갱신. 저장된 행을 돌려준다."""
    ins = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = ins(AdminAiSkillReport).values(values)
    cols = {c: getattr(stmt.excluded, c) for c in values if c not in _KEYS}
    stmt = stmt.on_conflict_do_update(index_elements=list(_KEYS), set_={**cols, "updated_at": func.now()})
    session.execute(stmt)
    session.commit()
    return get(session, values["ticker"], values["as_of_date"])


def get(session: Session, ticker: str, as_of: date) -> dict | None:
    row = session.scalars(select(AdminAiSkillReport).where(AdminAiSkillReport.ticker == ticker,
                                                           AdminAiSkillReport.as_of_date == as_of)).first()
    return report_out(row) if row is not None else None


def latest(session: Session, ticker: str) -> dict | None:
    row = session.scalars(select(AdminAiSkillReport).where(AdminAiSkillReport.ticker == ticker)
                          .order_by(AdminAiSkillReport.as_of_date.desc()).limit(1)).first()
    return report_out(row) if row is not None else None


def list_page(session: Session, *, page: int, page_size: int, ticker: str | None = None) -> dict:
    """최근 기준일 순 한 쪽. 쪽 번호가 범위를 넘으면 마지막 쪽(daily_surge_query._page 와 같은 규칙)."""
    cond = [AdminAiSkillReport.ticker == ticker] if ticker else []
    total = int(session.scalar(select(func.count()).select_from(AdminAiSkillReport).where(*cond)) or 0)
    pages = max(1, -(-total // page_size))
    page = min(max(1, page), pages)
    rows = session.scalars(
        select(AdminAiSkillReport).where(*cond)
        .order_by(AdminAiSkillReport.as_of_date.desc(), AdminAiSkillReport.updated_at.desc(),
                  AdminAiSkillReport.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [summary_out(r) for r in rows], "total": total, "page": page, "page_size": page_size,
            "pages": pages}


def surge_top(session: Session, limit: int) -> list[str]:
    """최신 급등락 집계일의 급등 상위 종목코드(surge_rank 오름차순)."""
    d = session.scalar(select(func.max(DailySurgeStock.trade_date)))  # 최신 집계일(그날 급등이 없으면 빈 목록)
    if d is None:
        return []
    rows = session.scalars(
        select(DailySurgeStock.ticker).where(DailySurgeStock.trade_date == d, DailySurgeStock.is_surge.is_(True))
        .order_by(DailySurgeStock.surge_rank.asc().nulls_last(), DailySurgeStock.change_rate.desc())
        .limit(limit)
    ).all()
    return list(rows)

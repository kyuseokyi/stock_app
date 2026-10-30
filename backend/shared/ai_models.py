"""AI 시황 분석(PG) — 일별 모닝 브리핑·스크리너 종목 정성 분석 캐시.

스펙 §3.1. 제약·인덱스 이름은 마이그레이션과 같게 명시한다(자동 이름 ix_... 금지).
red_flags 기본값 '[]'::jsonb 는 마이그레이션(server_default)에만 둔다 — 모델에 넣으면 sqlite create_all 이 깨진다.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Date, DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base

_JSON = JSON().with_variant(JSONB(), "postgresql")


class AiDailyBriefing(Base):
    __tablename__ = "ai_daily_briefings"
    __table_args__ = (Index("idx_ai_daily_briefings_date", "date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[dt.date] = mapped_column(Date, unique=True, nullable=False)
    headline: Mapped[str] = mapped_column(String(255), nullable=False)
    us_market_summary: Mapped[str] = mapped_column(Text, nullable=False)
    kr_impact_summary: Mapped[str] = mapped_column(Text, nullable=False)
    bullish_sectors: Mapped[list] = mapped_column(_JSON, nullable=False)
    bearish_sectors: Mapped[list] = mapped_column(_JSON, nullable=False)
    macro_checkpoints: Mapped[list] = mapped_column(_JSON, nullable=False)
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiStockEvaluation(Base):
    __tablename__ = "ai_stock_evaluations"
    __table_args__ = (
        UniqueConstraint("ticker", "date", name="uq_ai_stock_eval_ticker_date"),
        Index("idx_ai_stock_eval_date", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    hook_summary: Mapped[str] = mapped_column(String(255), nullable=False)
    growth_quality: Mapped[str] = mapped_column(String(50), nullable=False)
    financial_quality_note: Mapped[str] = mapped_column(Text, nullable=False)
    red_flag_level: Mapped[str] = mapped_column(String(20), nullable=False)
    red_flags: Mapped[list | None] = mapped_column(_JSON, default=list)
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

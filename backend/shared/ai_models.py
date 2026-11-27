"""AI 시황 분석(PG) — 일별 모닝 브리핑·스크리너 종목 정성 분석 캐시·관리자 AI Lab 리포트.

스펙 §3.1(+ AI Lab 리포트 — 설계 docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절). 제약·인덱스 이름은 마이그레이션과 같게 명시한다(자동 이름 ix_... 금지).
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
    # 근거 기사 [{title, url, pub_date}] — 서비스가 채운다(LLM 출력 아님). 옛 행은 NULL → API 에서 []
    sources: Mapped[list | None] = mapped_column(_JSON, nullable=True)
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
    # 근거 기사 [{title, url, pub_date}] — 서비스가 채운다(LLM 출력 아님). 옛 행은 NULL → API 에서 []
    sources: Mapped[list | None] = mapped_column(_JSON, nullable=True)
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AdminAiSkillReport(Base):
    """관리자 AI Lab 종목 심층 분석 리포트(B단계) — (종목, 기준 거래일)당 1행, 다시 분석하면 덮어쓴다(upsert).

    숫자(정량 팩트·손절·주식 수·EV 기대수익률)는 파이썬 계산값만, Gemini 는 해석 문장·시나리오 목표가·확률·공시 촉매 평가만.
    공시 촉매는 DART 공시 기준(dart_catalysts) — 외부 기사 데이터는 이 표에 저장하지 않는다.
    설계: docs/superpowers/specs/2026-11-27-admin-ai-lab-design.md 3절
    """

    __tablename__ = "admin_ai_skill_reports"
    __table_args__ = (UniqueConstraint("ticker", "as_of_date", name="uq_admin_skill_report_ticker_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    stock_name: Mapped[str] = mapped_column(String(100), nullable=False)
    as_of_date: Mapped[dt.date] = mapped_column(Date, nullable=False)  # 분석 기준 거래일(정량 팩트의 마지막 봉 날짜)
    quant_facts: Mapped[dict] = mapped_column(_JSON, nullable=False)
    sepa_analysis: Mapped[dict] = mapped_column(_JSON, nullable=False)
    vibe_backtest: Mapped[dict] = mapped_column(_JSON, nullable=False)
    exposure_and_sizing: Mapped[dict] = mapped_column(_JSON, nullable=False)
    logic_chain_and_thesis: Mapped[dict] = mapped_column(_JSON, nullable=False)
    ev_scenarios: Mapped[dict] = mapped_column(_JSON, nullable=False)
    k_dart_and_valuation: Mapped[dict] = mapped_column(_JSON, nullable=False)
    dart_catalysts: Mapped[list] = mapped_column(_JSON, nullable=False)
    overall_verdict: Mapped[str] = mapped_column(String(50), nullable=False)
    executive_summary: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 최근 기준일 순 목록용 — 이름·정렬 방향은 마이그레이션과 같게
Index("idx_admin_skill_reports_date", AdminAiSkillReport.as_of_date.desc())

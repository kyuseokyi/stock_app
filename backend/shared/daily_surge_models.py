"""급등락·테마 분석 결과(PG) — 날짜별 종목 행·테마 묶음·관리자 메모.

종목·묶음은 집계가 날짜 단위로 통째 교체한다(멱등). 메모는 사람이 쓴 글이라 집계가 건드리지 않는다.
네이버 뉴스는 저장하지 않는다(약관 — docs/naver-search-api-terms-issue.md). 공시(DART)는 저장한다.
설계: docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (JSON, BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String,
                        UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base

_JSON = JSON().with_variant(JSONB(), "postgresql")


class DailySurgeStock(Base):
    """날짜별 급등·급락·거래대금 상위 종목(그 밖의 종목은 저장하지 않는다)."""

    __tablename__ = "daily_surge_stocks"
    __table_args__ = (Index("ix_daily_surge_stocks_trade_date", "trade_date"),)

    trade_date: Mapped[date] = mapped_column(Date, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    market: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    close: Mapped[float] = mapped_column(Float, nullable=False)
    prev_close: Mapped[float] = mapped_column(Float, nullable=False)
    change_price: Mapped[float] = mapped_column(Float, nullable=False)
    change_rate: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False)
    volume_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    trading_value: Mapped[float] = mapped_column(Float, nullable=False)
    is_surge: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_plunge: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_top_value: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    surge_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plunge_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_theme_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_theme_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_theme_leader: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dart_items: Mapped[list] = mapped_column(_JSON, nullable=False, default=list)
    dart_keywords: Mapped[list] = mapped_column(_JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DailySurgeThemeGroup(Base):
    """날짜·테마·방향별 동반 급등(급락) 묶음 — 같은 방향 2종목 이상."""

    __tablename__ = "daily_surge_theme_groups"

    trade_date: Mapped[date] = mapped_column(Date, primary_key=True)
    theme_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(5), primary_key=True)  # up | down
    theme_name: Mapped[str] = mapped_column(String(100), nullable=False)
    stock_count: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_change_rate: Mapped[float] = mapped_column(Float, nullable=False)
    value_sum: Mapped[float] = mapped_column(Float, nullable=False)
    leader_ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    leader_name: Mapped[str] = mapped_column(String(100), nullable=False)
    members: Mapped[list] = mapped_column(_JSON, nullable=False, default=list)  # 거래대금 내림차순 종목코드
    theme_source: Mapped[str] = mapped_column(String(10), nullable=False, default="kis")  # kiwoom | kis
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DailySurgeNote(Base):
    """관리자 이유 메모 — (날짜, 테마) 또는 (날짜, 종목)에 한 줄. 표시는 종목 메모 > 테마 메모."""

    __tablename__ = "daily_surge_notes"
    __table_args__ = (UniqueConstraint("trade_date", "scope", "target", name="uq_daily_surge_notes_target"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(10), nullable=False)  # theme | stock
    target: Mapped[str] = mapped_column(String(20), nullable=False)  # 테마 id 문자열 | 종목코드
    note: Mapped[str] = mapped_column(String(300), nullable=False)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

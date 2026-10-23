"""시장 참조 데이터(PG) — 종목 프로필·업종·테마·일정. 스크리너 프로젝트 1.

stock_meta(검색·차트·수집 대상의 단일 마스터)는 건드리지 않고 1:1 로 옆에 둔다.
티커 FK 는 걸지 않는다 — 테마 마스터에 상폐 종목이 남아 있어도 동기화가 깨지지 않게.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.models import Base, TimestampMixin


class StockProfile(Base):
    """.mst 뒤쪽 필드 — 업종·시가총액·상장주식수·상장일·상태 표시."""

    __tablename__ = "stock_profile"

    ticker: Mapped[str] = mapped_column(String(20), primary_key=True)
    market: Mapped[str] = mapped_column(String(10), nullable=False)
    mcap_size: Mapped[str] = mapped_column(String(1), nullable=False, default="")
    sector_l: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    sector_m: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    sector_s: Mapped[str] = mapped_column(String(4), nullable=False, default="")
    is_etp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_spac: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_halted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_managed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    warning_code: Mapped[str] = mapped_column(String(2), nullable=False, default="")
    listed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    listed_shares_k: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 천 주
    market_cap_100m: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # 억 원(전일 기준)
    settle_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Sector(Base):
    """KRX 지수업종 코드 → 이름(idxcode.mst)."""

    __tablename__ = "sectors"

    code: Mapped[str] = mapped_column(String(4), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)


class Theme(Base, TimestampMixin):
    """테마 — KIS theme_code.mst(source=kis) 또는 관리자 생성(source=admin)."""

    __tablename__ = "themes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kis_code: Mapped[str | None] = mapped_column(String(10), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="kis")  # kis | admin
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class ThemeStock(Base):
    """테마-종목 연결. KIS 동기화는 source=kis 행만 바꾼다(관리자 추가·제외 표시는 유지)."""

    __tablename__ = "theme_stocks"

    theme_id: Mapped[int] = mapped_column(ForeignKey("themes.id", ondelete="CASCADE"), primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="kis")  # kis | admin
    is_excluded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class StockEvent(Base, TimestampMixin):
    """일정 캘린더 — 공모주 청약·상장(KIS 예탁원), 미국 경제지표 발표(FRED). source_key 로 멱등."""

    __tablename__ = "stock_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)  # 공모주 | 경제지표
    ticker: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # kis | fred
    source_key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)


class ScreenerFeature(Base):
    """스크리너 탭 보이기 스위치(FINDER=조건검색, PATTERNS=차트 패턴) — 관리자가 켜고 끈다.
    행이 없으면 서비스가 OFF(숨김)로 본다 — 아직 다듬는 중인 탭을 기본으로 막아 두기 위해(게임 플래그와 반대)."""

    __tablename__ = "screener_features"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

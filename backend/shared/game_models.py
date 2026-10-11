"""트레이딩 게임 PostgreSQL ORM 모델 (핵심 6테이블).

Phase 1 범위: 시즌/계좌/포지션/거래/명예의전당/코치메시지.
교육·소셜 테이블(chart_quiz_pool, user_streaks, private_leagues)은 추후 Phase.

users.id 가 Integer 이므로 유저 참조 FK(user_id/author_id)는 Integer,
게임 내부 PK(계좌/포지션/거래)는 UUID 를 쓴다. UUID 는 PostgreSQL 에선 네이티브
UUID, 그 외(테스트용 sqlite)에선 CHAR(32) 로 동작하도록 GUID 로 감싼다.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import CHAR, TypeDecorator

from shared.models import Base, TimestampMixin

INITIAL_CASH = Decimal("10000000")


class GUID(TypeDecorator):
    """DB 중립 UUID. PostgreSQL=native UUID, 그 외(sqlite)=CHAR(32) hex.

    sqlalchemy.Uuid 대신 커스텀 GUID TypeDecorator 를 의도적으로 유지한다
    (계획에 따라 PG-UUID / CHAR(32) 매핑을 명시적으로 제어하기 위함).
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(32))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            value = uuid.UUID(str(value))
        if dialect.name == "postgresql":
            return value
        return value.hex

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(value)


class GameSeason(Base, TimestampMixin):
    """시즌 마스터. 종목 1개 고정. end_at NULL=무기한/미정."""

    __tablename__ = "game_seasons"
    __table_args__ = (UniqueConstraint("season_number", name="uq_season_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    stock_name: Mapped[str] = mapped_column(String(50), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    initial_cash: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=INITIAL_CASH)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="READY")

    accounts: Mapped[list["GameAccount"]] = relationship(back_populates="season", passive_deletes=True)


class GameAccount(Base, TimestampMixin):
    """유저 시즌별 가상 계좌. (user_id, season_id) 유일."""

    __tablename__ = "game_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "season_id", name="uq_user_season_account"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    cash_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=INITIAL_CASH)
    total_asset: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=INITIAL_CASH)
    current_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=Decimal("0"))
    max_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False, default=Decimal("0"))
    total_trades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_trades: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    season: Mapped["GameSeason"] = relationship(back_populates="accounts")
    positions: Mapped[list["GamePosition"]] = relationship(back_populates="account", passive_deletes=True)
    trades: Mapped[list["GameTrade"]] = relationship(back_populates="account", passive_deletes=True)


class GamePosition(Base, TimestampMixin):
    """활성 포지션. LONG/SHORT·레버리지·TP/SL."""

    __tablename__ = "game_positions"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("game_accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    side: Mapped[str] = mapped_column(String(10), nullable=False)  # 'LONG'/'SHORT'
    entry_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    size_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    leverage: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    stop_loss_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    take_profit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")

    account: Mapped["GameAccount"] = relationship(back_populates="positions")


class GameTrade(Base):
    """청산 완료 내역. TimestampMixin 미사용(closed_at 단일 시각)."""

    __tablename__ = "game_trades"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("game_accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    side: Mapped[str] = mapped_column(String(10), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    exit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    pnl_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    roi_pct: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    closed_reason: Mapped[str] = mapped_column(String(20), nullable=False)
    closed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    account: Mapped["GameAccount"] = relationship(back_populates="trades")


class HallOfFame(Base):
    """시즌 최종 1~100위 박제."""

    __tablename__ = "hall_of_fame"
    __table_args__ = (
        UniqueConstraint("season_id", "rank", name="uq_hof_season_rank"),
        UniqueConstraint("season_id", "user_id", name="uq_hof_season_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    user_nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    final_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    final_asset: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    win_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    trading_mbti: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GameCoachMessage(Base):
    """관리자 스마트 코치 브리핑(모닝/이브닝/인플레이) + 지지/저항선."""

    __tablename__ = "game_coach_messages"
    __table_args__ = (
        UniqueConstraint("season_id", "target_date", "coach_type", name="uq_coach_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    target_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    coach_type: Mapped[str] = mapped_column(String(20), nullable=False)  # MORNING/EVENING/IN_PLAY
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    summary_nudge: Mapped[str] = mapped_column(String(200), nullable=False)
    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    support_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    resistance_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    author_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

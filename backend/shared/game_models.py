"""트레이딩 게임 PostgreSQL ORM 모델 (핵심 6테이블).

Phase 1 범위: 시즌/계좌/포지션/거래/명예의전당/코치메시지.
Phase 5b: 퀘스트·배지·아카데미·차트 퀴즈·Streak·기능 플래그. private_leagues 는 추후 Phase.

users.id 가 Integer 이므로 유저 참조 FK(user_id/author_id)는 Integer,
게임 내부 PK(계좌/포지션/거래)는 UUID 를 쓴다. UUID 는 PostgreSQL 에선 네이티브
UUID, 그 외(테스트용 sqlite)에선 CHAR(32) 로 동작하도록 GUID 로 감싼다.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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

    accounts: Mapped[list["GameAccount"]] = relationship(
        back_populates="season", cascade="all, delete-orphan", passive_deletes=True
    )


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
    # Phase 5b: 보상 지급 시 늘어나는 원금 조정분(펀드 입금 방식). 원금 = INITIAL_CASH + bonus_cash.
    bonus_cash: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False, default=Decimal("0"), server_default="0"
    )

    season: Mapped["GameSeason"] = relationship(back_populates="accounts")
    positions: Mapped[list["GamePosition"]] = relationship(
        back_populates="account", cascade="all, delete-orphan", passive_deletes=True
    )
    trades: Mapped[list["GameTrade"]] = relationship(
        back_populates="account", cascade="all, delete-orphan", passive_deletes=True
    )


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
    entry_ratio: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))

    __table_args__ = (
        Index(
            "uq_account_single_open",
            "account_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            sqlite_where=text("status = 'OPEN'"),
        ),
    )

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
    size_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, default=Decimal("0"))
    leverage: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    entry_ratio: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    had_stop_loss: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
    user_nickname: Mapped[str] = mapped_column(String(100), nullable=False)
    final_roi: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    final_asset: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    win_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    trading_mbti: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GameCoachMessage(Base):
    """관리자 스마트 코치 브리핑(모닝/이브닝/인플레이) + 지지/저항선. (Phase 5a: status 로 초안/발행 구분)"""

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
    # DRAFT(임시저장) | PUBLISHED(발행). ORM 기본은 DRAFT(안전). server_default PUBLISHED 는
    # 마이그레이션에서 기존 행 백필 전용.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="DRAFT", server_default="PUBLISHED"
    )
    # 발행 시각 — PUBLISHED 로 전환될 때 서비스가 기록. 초안은 NULL.
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    author_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


# ---------------------------------------------------------------- Phase 5b: 교육·습관 테이블


class UserQuestProgress(Base):
    """유저별 퀘스트 진행(영구 1회성). 퀘스트 정의는 코드 상수(quest_service.QUESTS)."""

    __tablename__ = "user_quest_progress"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    quest_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserBadge(Base):
    """보유 배지(퀘스트 보상)."""

    __tablename__ = "user_badges"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    badge_code: Mapped[str] = mapped_column(String(30), primary_key=True)
    awarded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UserAcademy(Base):
    """아카데미 수료 상태 — 5배 레버리지 해금 플래그."""

    __tablename__ = "user_academy"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    unlocked_leverage_5x: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    passed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ChartQuiz(Base):
    """야간 차트 패턴 퀴즈 풀(자동 생성). (ticker, base_date) 유일."""

    __tablename__ = "chart_quiz_pool"
    __table_args__ = (UniqueConstraint("ticker", "base_date", name="uq_quiz_ticker_base_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticker: Mapped[str] = mapped_column(String(20), nullable=False)
    base_date: Mapped[date] = mapped_column(Date, nullable=False)
    pattern_type: Mapped[str] = mapped_column(String(50), nullable=False)
    chart_snapshot: Mapped[list] = mapped_column(JSON, nullable=False)  # OHLCV dict 배열(기준일까지)
    answer: Mapped[str] = mapped_column(String(10), nullable=False)  # 'UP' / 'DOWN'
    actual_change: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    reward_cash: Mapped[int] = mapped_column(
        Integer, nullable=False, default=200000, server_default="200000"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # 비활성 문제는 출제·재고 계산에서 제외(백로그 ⑤-2). 이미 출제된 문제의 제출은 허용
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class AcademyQuestion(Base):
    """아카데미(5배 레버리지 해금) 문항 — 관리자 편집(백로그 ⑤-2). 활성 문항 전부 정답이면 해금."""

    __tablename__ = "academy_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    choices: Mapped[list] = mapped_column(JSON, nullable=False)  # 문자열 배열(2~6개)
    answer: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-based
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UserQuizAttempt(Base):
    """퀴즈 출제·제출 기록. served_at 으로 서버가 제한시간을 판정한다."""

    __tablename__ = "user_quiz_attempts"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    quiz_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chart_quiz_pool.id", ondelete="CASCADE"), primary_key=True
    )
    served_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    choice: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    rewarded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    reward_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # 보상 지급 KST 날짜(일일 한도)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserStreak(Base):
    """연속 출석(KST 날짜 기준)."""

    __tablename__ = "user_streaks"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    highest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_activity_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class StreakRewardClaim(Base):
    """연속 출석 마일스톤 보상 수령 기록(백로그 ⑤-1) — 시즌마다 마일스톤별 1회."""

    __tablename__ = "streak_reward_claims"
    __table_args__ = (
        UniqueConstraint("user_id", "season_id", "milestone", name="uq_streak_reward_user_season_milestone"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
    )
    milestone: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    claimed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WeeklyRankingResult(Base):
    """주간 랭킹 마감 기록(Top 10) + 1~3위 보상액. notified_at = 보상 토스트 확인 시각."""

    __tablename__ = "weekly_ranking_results"
    __table_args__ = (
        UniqueConstraint("season_id", "week_start", "rank", name="uq_weekly_result_rank"),
        UniqueConstraint("season_id", "week_start", "user_id", name="uq_weekly_result_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("game_seasons.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    nickname: Mapped[str | None] = mapped_column(String(50), nullable=True)
    weekly_roi: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)
    reward_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False, server_default="0")
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class GameFeatureFlag(Base):
    """기능 on/off(QUIZ, STREAK). 행이 없으면 서비스가 ON 으로 간주."""

    __tablename__ = "game_feature_flags"

    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

"""PostgreSQL SQLAlchemy ORM 모델 정의.

아키텍처 설계서(docs/architecture_plan.md)의 "PostgreSQL 스키마" 섹션을 근거로
관계형 데이터(회원, 게시판, 블로그, 푸시 템플릿, 종목 마스터)를 정의한다.

주의: 시계열/OLAP 데이터(daily_prices, fundamentals)는 ClickHouse에서 관리하며
      ORM 대상이 아니므로 이 파일에 포함하지 않는다.
"""

from __future__ import annotations

import enum
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    """모든 ORM 모델의 공통 베이스."""


class TimestampMixin:
    """생성/수정 시각 공통 컬럼."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UserRole(str, enum.Enum):
    """회원 권한 등급. 값이 높을수록 상위 권한(접근 범위 판단에 사용)."""

    FREE = "FREE"
    PREMIUM = "PREMIUM"
    ADMIN = "ADMIN"


class AuthProvider(str, enum.Enum):
    """소셜 로그인 공급자."""

    KAKAO = "KAKAO"
    GOOGLE = "GOOGLE"
    APPLE = "APPLE"
    NAVER = "NAVER"


class MarketType(str, enum.Enum):
    """국내 주식 시장 구분."""

    KOSPI = "KOSPI"
    KOSDAQ = "KOSDAQ"
    KONEX = "KONEX"


# --- 사용자별 Role 을 Enum 컬럼으로 재사용하기 위한 헬퍼 ---
role_enum = SAEnum(UserRole, name="user_role")


class User(Base, TimestampMixin):
    """회원 정보. 소셜 로그인 토큰, FCM 디바이스 토큰, 권한(Role)을 보관한다."""

    __tablename__ = "users"
    # 같은 공급자 계정(provider+provider_id)은 한 명. 둘 다 NULL 인 기존(관리자·게스트) 행끼리는 충돌하지 않는다.
    __table_args__ = (
        UniqueConstraint("provider", "provider_id", name="uq_users_provider_provider_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    nickname: Mapped[str | None] = mapped_column(String(100))
    profile_image_url: Mapped[str | None] = mapped_column(String(512))

    # 소셜 로그인 (LOCAL 관리자 계정은 provider/provider_id 없이 email+password 사용)
    provider: Mapped[AuthProvider | None] = mapped_column(
        SAEnum(AuthProvider, name="auth_provider"), nullable=True
    )
    provider_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    social_token: Mapped[str | None] = mapped_column(Text)  # 공급자 Access/ID 토큰

    # 이메일/비밀번호 로그인용 해시 (관리자/스태프 계정). 소셜 유저는 NULL.
    password_hash: Mapped[str | None] = mapped_column(String(255))

    # 푸시 알림
    fcm_token: Mapped[str | None] = mapped_column(String(512))

    # 권한
    role: Mapped[UserRole] = mapped_column(
        role_enum, default=UserRole.FREE, server_default=UserRole.FREE.value, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 이용약관 동의 — 마지막으로 동의한 약관 버전과 시각(미동의·기존 회원은 NULL). 판정은 apps/auth/terms.py
    terms_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    terms_agreed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 댓글 작성 금지 시각(관리자 조치). NULL=정상. 설정되면 댓글 작성·수정 403 COMMENT_BANNED
    comment_banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 관계
    # author_id 가 nullable(SET NULL)이므로 delete-orphan 대신 연결만 관리.
    posts: Mapped[list["BlogPost"]] = relationship(back_populates="author")
    comments: Mapped[list["BlogComment"]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )


SESSION_PLATFORMS = ("web", "app", "admin")


class UserSession(Base, TimestampMixin):
    """플랫폼(web/app/admin)별 현재 유효 로그인 1개. 새 로그인이 sid 를 덮어써 같은 플랫폼의 이전 토큰을 무효화한다."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        CheckConstraint("platform IN ('web', 'app', 'admin')", name="ck_user_sessions_platform"),
    )

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    platform: Mapped[str] = mapped_column(String(16), primary_key=True)
    sid: Mapped[str] = mapped_column(String(64), nullable=False)


class RefreshToken(Base):
    """앱 리프레시 토큰(원문은 클라이언트만, 여기엔 SHA-256 해시). 로그인 sid 에 묶이고 갱신마다 회전한다.

    설계: docs/superpowers/specs/2026-10-22-mobile-refresh-token-design.md
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(16), nullable=False, default="app")
    sid: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 회전 후속 토큰. 정리(만료·폐기 7일 후 삭제) 때 참조 중인 행이 남아도 깨지지 않게 SET NULL
    replaced_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Board(Base, TimestampMixin):
    """게시판/메뉴 카테고리. 접근 최소 권한(min_role_required)을 가진다."""

    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 게시판별 댓글 허용 여부 (관리자 토글). 새 게시판은 꺼진 상태로 만든다(신고·차단 운영 준비 후 켠다)
    comments_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    min_role_required: Mapped[UserRole] = mapped_column(
        role_enum, default=UserRole.FREE, server_default=UserRole.FREE.value, nullable=False
    )

    posts: Mapped[list["BlogPost"]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )


class BlogPost(Base, TimestampMixin):
    """블로그 게시글. 특정 board_id 에 속하며 본문은 HTML 로 저장한다."""

    __tablename__ = "blog_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 인증 슬라이스 이전에는 작성자 없이도 글을 생성할 수 있도록 nullable.
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # HTML 본문
    thumbnail_url: Mapped[str | None] = mapped_column(String(512))
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 홈 추천(큐레이션): 켠 시각. NULL=추천 아님. 홈은 featured_at DESC 로 노출.
    featured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    board: Mapped["Board"] = relationship(back_populates="posts")
    author: Mapped["User"] = relationship(back_populates="posts")
    comments: Mapped[list["BlogComment"]] = relationship(
        back_populates="post", cascade="all, delete-orphan"
    )


class BlogComment(Base, TimestampMixin):
    """블로그 댓글. post_id FK 로 게시글에 연결된다."""

    __tablename__ = "blog_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 신고 누적으로 가려진 시각. NULL=공개. 관리자 기각(dismiss) 시 다시 NULL
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    post: Mapped["BlogPost"] = relationship(back_populates="comments")
    author: Mapped["User"] = relationship(back_populates="comments")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


COMMENT_REPORT_REASONS = ("abuse", "spam", "sexual", "privacy", "scam", "other")
COMMENT_REPORT_STATUSES = ("pending", "dismissed", "actioned")


class CommentReport(Base):
    """댓글 신고. 같은 사람이 같은 댓글을 두 번 신고할 수 없다(UNIQUE)."""

    __tablename__ = "comment_reports"
    __table_args__ = (
        UniqueConstraint("comment_id", "reporter_id", name="uq_comment_reports_comment_reporter"),
        CheckConstraint(
            "reason IN ('abuse','spam','sexual','privacy','scam','other')", name="ck_comment_reports_reason"
        ),
        CheckConstraint("status IN ('pending','dismissed','actioned')", name="ck_comment_reports_status"),
        Index("ix_comment_reports_reporter_id", "reporter_id"),
        Index("ix_comment_reports_status", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("blog_comments.id", ondelete="CASCADE"), nullable=False
    )
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # 최대 200자(스키마에서 검사)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", server_default="pending", nullable=False
    )
    # 파이썬 기본값도 둔다 — 같은 초에 생긴 행끼리도 최신순 정렬이 흔들리지 않게(마이크로초)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )


class UserBlock(Base):
    """사용자 차단. blocker 에게 blocked 의 댓글이 보이지 않는다(복합 PK — 같은 쌍은 한 행)."""

    __tablename__ = "user_blocks"
    __table_args__ = (Index("ix_user_blocks_blocked_id", "blocked_id"),)

    blocker_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # 파이썬 기본값도 둔다 — 같은 초에 생긴 행끼리도 최신순 정렬이 흔들리지 않게(마이크로초)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )


class PushTemplate(Base, TimestampMixin):
    """수동 발송용 푸시 알림 템플릿 및 발송 이력."""

    __tablename__ = "push_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StockMeta(Base, TimestampMixin):
    """주식 종목 마스터 정보(종목코드, 회사명, 시장구분)."""

    __tablename__ = "stock_meta"

    ticker: Mapped[str] = mapped_column(String(20), primary_key=True)  # 종목코드
    name: Mapped[str] = mapped_column(String(100), nullable=False)  # 회사명
    market: Mapped[MarketType] = mapped_column(
        SAEnum(MarketType, name="market_type"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class PushDevice(Base, TimestampMixin):
    """기기 단위 Expo 푸시 토큰. 알림 종류별 수신 여부(fund_notice·post_notice)를 기기마다 둔다(users.fcm_token 과 별개)."""

    __tablename__ = "push_devices"
    __table_args__ = (
        CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    fund_notice: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )
    # 새 글 알림 수신(앱 내정보 스위치). 구버전 앱은 보내지 않으므로 기본 true
    post_notice: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true(), nullable=False
    )


class PushSend(Base):
    """관리자 푸시 발송 1건(즉시·테스트·예약). 상태: scheduled → sending → done|failed, scheduled → cancelled."""

    __tablename__ = "push_sends"
    __table_args__ = (
        Index("ix_push_sends_status_scheduled_at", "status", "scheduled_at"),
        Index("ix_push_sends_kind_ref_date", "kind", "ref_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    ref_date: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    target_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    success_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    failure_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("push_templates.id", ondelete="SET NULL")
    )
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AppVersionConfig(Base):
    """모바일 앱 업데이트 정책(플랫폼별 1행) — 스토어 최신/최소 버전·강제 여부, OTA 정책, 점검 모드.

    명세: docs/app_update_management_spec.md §3-1. 기본 행(android·ios)은 마이그레이션이 시드한다.
    """

    __tablename__ = "app_version_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)  # android | ios
    latest_version: Mapped[str] = mapped_column(String(20), nullable=False)
    min_supported_version: Mapped[str] = mapped_column(String(20), nullable=False)
    force_update_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    store_url: Mapped[str] = mapped_column(String(255), nullable=False)
    store_title: Mapped[str] = mapped_column(String(100), nullable=False)
    store_message: Mapped[str] = mapped_column(Text, nullable=False)
    # SILENT | OPTIONAL | MANDATORY
    ota_policy: Mapped[str] = mapped_column(
        String(20), default="SILENT", server_default="SILENT", nullable=False
    )
    ota_title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ota_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_maintenance: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    maintenance_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)


class AdConfig(Base):
    """광고 원격 설정 — 전체 스위치(GLOBAL_WEB·GLOBAL_MOBILE)와 슬롯별 설정(명세 docs/ad_monetization_spec_and_plan.md §3)."""

    __tablename__ = "ad_configs"

    slot_key: Mapped[str] = mapped_column(String(50), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    # GOOGLE(AdSense·AdMob) | HOUSE(자체 배너)
    provider: Mapped[str] = mapped_column(String(20), default="HOUSE", server_default="HOUSE", nullable=False)
    infeed_interval: Mapped[int] = mapped_column(Integer, default=7, server_default="7", nullable=False)
    house_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    house_description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    house_target_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by: Mapped[str | None] = mapped_column(String(100), nullable=True)

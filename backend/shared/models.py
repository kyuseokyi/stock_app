"""PostgreSQL SQLAlchemy ORM 모델 정의.

아키텍처 설계서(docs/architecture_plan.md)의 "PostgreSQL 스키마" 섹션을 근거로
관계형 데이터(회원, 게시판, 블로그, 푸시 템플릿, 종목 마스터)를 정의한다.

주의: 시계열/OLAP 데이터(daily_prices, fundamentals)는 ClickHouse에서 관리하며
      ORM 대상이 아니므로 이 파일에 포함하지 않는다.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
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

    # 관계
    # author_id 가 nullable(SET NULL)이므로 delete-orphan 대신 연결만 관리.
    posts: Mapped[list["BlogPost"]] = relationship(back_populates="author")
    comments: Mapped[list["BlogComment"]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )


class Board(Base, TimestampMixin):
    """게시판/메뉴 카테고리. 접근 최소 권한(min_role_required)을 가진다."""

    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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

    post: Mapped["BlogPost"] = relationship(back_populates="comments")
    author: Mapped["User"] = relationship(back_populates="comments")


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

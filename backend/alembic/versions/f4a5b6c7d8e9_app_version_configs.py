"""앱 업데이트 관리 — app_version_configs(플랫폼별 스토어 버전·강제·OTA 정책·점검 모드) + android·ios 기본 행

명세: docs/app_update_management_spec.md §3-1

Revision ID: f4a5b6c7d8e9
Revises: d2e3f4a5b6c7
Create Date: 2026-10-22
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f4a5b6c7d8e9"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None

# 시드 문구는 서비스 기본값(apps/blog/services/app_version.py DEFAULTS)과 같게 유지
_STORE_TITLE = "업데이트 안내"
_STORE_MESSAGE = "안정적인 서비스 이용을 위해 최신 버전 업데이트가 필요합니다."
_OTA_TITLE = "새 기능 업데이트"
_OTA_MESSAGE = "새로운 기능과 버그 수정이 다운로드되었습니다. 지금 재시작하시겠습니까?"
# 운영 패키지/번들 ID = com.stockapp (mobile/app.config.js). App Store 는 숫자 앱 ID 가 있어야 열리므로
# iOS 링크는 출시 후 관리자 화면에서 실제 주소로 교체해야 한다(플레이스홀더).
_ANDROID_URL = "https://play.google.com/store/apps/details?id=com.stockapp"
_IOS_URL = "https://apps.apple.com/app/id0000000000"


def upgrade() -> None:
    table = op.create_table(
        "app_version_configs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("latest_version", sa.String(20), nullable=False),
        sa.Column("min_supported_version", sa.String(20), nullable=False),
        sa.Column("force_update_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("store_url", sa.String(255), nullable=False),
        sa.Column("store_title", sa.String(100), nullable=False),
        sa.Column("store_message", sa.Text(), nullable=False),
        sa.Column("ota_policy", sa.String(20), server_default="SILENT", nullable=False),
        sa.Column("ota_title", sa.String(100), nullable=True),
        sa.Column("ota_message", sa.Text(), nullable=True),
        sa.Column("is_maintenance", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("maintenance_message", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.String(100), nullable=True),
    )
    op.create_index("ix_app_version_configs_platform", "app_version_configs", ["platform"], unique=True)

    common = dict(
        latest_version="1.0.0",
        min_supported_version="1.0.0",
        force_update_enabled=False,
        store_title=_STORE_TITLE,
        store_message=_STORE_MESSAGE,
        ota_policy="SILENT",
        ota_title=_OTA_TITLE,
        ota_message=_OTA_MESSAGE,
        is_maintenance=False,
        maintenance_message=None,
        updated_by=None,
    )
    op.bulk_insert(
        table,
        [
            {"platform": "android", "store_url": _ANDROID_URL, **common},
            {"platform": "ios", "store_url": _IOS_URL, **common},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_app_version_configs_platform", table_name="app_version_configs")
    op.drop_table("app_version_configs")

"""상용 패키지명 변경 — app_version_configs android store_url 을 com.stockapp → com.stocknote

설계: docs/deploy/package-rename-stocknote.md K6
com.stockapp 은 Google Play 에서 이미 다른 개발자가 쓰는 패키지라 상용 패키지를 com.stocknote 로 바꿨다.
옛 마이그레이션(f4a5b6c7d8e9)이 넣은 기본 주소만 바꾸고, 관리자가 다른 주소로 바꿔 둔 행은 건드리지 않는다.
(옛 파일은 이미 적용된 기록이라 고치지 않는다.)

Revision ID: e6f8a0b2c4d7
Revises: d5e7f9a1b3c5
Create Date: 2026-11-19
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e6f8a0b2c4d7"
down_revision = "d5e7f9a1b3c5"
branch_labels = None
depends_on = None

_OLD_URL = "https://play.google.com/store/apps/details?id=com.stockapp"
_NEW_URL = "https://play.google.com/store/apps/details?id=com.stocknote"

_UPDATE = sa.text(
    "UPDATE app_version_configs SET store_url = :new_url "
    "WHERE platform = 'android' AND store_url = :old_url"
)


def upgrade() -> None:
    # 주소가 정확히 옛 기본값일 때만 교체(관리자가 바꾼 주소 보존)
    op.execute(_UPDATE.bindparams(old_url=_OLD_URL, new_url=_NEW_URL))


def downgrade() -> None:
    # 역방향: 새 기본값인 행만 옛 주소로 되돌린다
    op.execute(_UPDATE.bindparams(old_url=_NEW_URL, new_url=_OLD_URL))

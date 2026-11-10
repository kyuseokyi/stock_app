# 4단계. Alembic 마이그레이션 — DB 에 실제로 테이블 만들기

> 목표: 마이그레이션 파일을 만들고, 읽고, 적용하고, 되돌릴 수 있다. 운영 DB 에 자동 적용되는 파일이므로 가장 조심해야 하는 단계다.

## 4-1. 마이그레이션이란

DB 구조 변경을 **순서가 있는 파일**로 남기는 것이다. `backend/alembic/versions/` 의 파일 하나 = 변경 한 번.

```
3df33e164159 (첫 스키마) → … → 8e2b4c6d1f30 (AI 테이블) → a9b8c7d6e5f4 (북마크, 지금 만들 것)
```
각 파일은 "내 앞은 누구(`down_revision`)" 를 적어서 줄을 선다. DB 의 `alembic_version` 테이블에 "지금 어디까지 적용됐는지" 가 저장된다.

- 로컬: 내가 `alembic upgrade head` 로 적용.
- 개발 서버: `main` 에 push 하면 배포 워크플로가 **자동으로** `alembic upgrade head` 를 실행한다.

## 4-2. 현재 위치 확인

```bash
cd backend
uv run alembic heads      # 파일 기준 마지막 버전 (예: 8e2b4c6d1f30 (head))
uv run alembic current    # 내 DB 가 적용된 버전 — heads 와 같아야 정상
```
`current` 가 `heads` 보다 뒤처져 있으면 먼저 `uv run alembic upgrade head` 로 맞춘다.

## 4-3. 마이그레이션 파일 만들기

### 방법 A — 자동 생성 (권장 출발점)
```bash
uv run alembic revision --autogenerate -m "blog bookmarks"
```
Alembic 이 **모델(`shared/*models.py`)과 실제 DB 를 비교**해서 차이를 코드로 써 준다. 그래서 **DB 가 켜져 있고 `current == heads` 여야** 정확하다.

생성된 파일은 **반드시 열어서 검토**한다. 자동 생성은 이런 실수를 한다.
- 우리와 무관한 차이(다른 사람이 DB 를 손으로 바꾼 흔적 등)까지 끼워 넣는다 → 지운다.
- 인덱스·제약조건 이름이 관례와 다르다 → 고친다.
- 컬럼 이름 변경을 "삭제 + 추가"로 만든다 → 데이터가 날아간다. 손으로 고친다.

### 방법 B — 직접 작성
이 프로젝트의 기존 파일들도 대부분 사람이 다듬은 형태다. 북마크는 아래처럼 쓴다.
파일: `backend/alembic/versions/a9b8c7d6e5f4_blog_bookmarks.py`
(revision id 는 아무 12자리 16진수. 자동 생성을 쓰면 알아서 정해 준다.)

```python
"""게시글 북마크 — blog_bookmarks

Revision ID: a9b8c7d6e5f4
Revises: 8e2b4c6d1f30
Create Date: 2026-11-09
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a9b8c7d6e5f4"
down_revision = "8e2b4c6d1f30"   # ← 4-2 의 heads 값. 틀리면 줄이 끊긴다
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blog_bookmarks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "post_id", name="uq_blog_bookmarks_user_post"),
    )
    op.create_index("ix_blog_bookmarks_user_id", "blog_bookmarks", ["user_id"])
    op.create_index("ix_blog_bookmarks_post_id", "blog_bookmarks", ["post_id"])


def downgrade() -> None:
    op.drop_index("ix_blog_bookmarks_post_id", table_name="blog_bookmarks")
    op.drop_index("ix_blog_bookmarks_user_id", table_name="blog_bookmarks")
    op.drop_table("blog_bookmarks")
```

### 파일 읽는 법
| 부분 | 뜻 |
|---|---|
| `revision` / `down_revision` | 내 번호 / 내 앞 번호 |
| `upgrade()` | 적용할 때 실행 (테이블 만들기) |
| `downgrade()` | 되돌릴 때 실행 — **upgrade 의 정확한 역순**으로 쓴다 (인덱스 먼저 지우고 테이블) |
| `op.create_table` / `op.create_index` | DDL 명령 |

> 인덱스 이름 `ix_<테이블>_<컬럼>` 은 모델에서 `index=True` 를 줬을 때 SQLAlchemy 가 짓는 이름과 같다. 그래야 다음 번 autogenerate 가 "인덱스가 다르다"고 착각하지 않는다.

## 4-4. 적용 전에 SQL 미리 보기 (DB 안 건드림)

```bash
uv run alembic upgrade 8e2b4c6d1f30:a9b8c7d6e5f4 --sql
```
실제 출력:
```sql
BEGIN;
-- Running upgrade 8e2b4c6d1f30 -> a9b8c7d6e5f4
CREATE TABLE blog_bookmarks (
    id SERIAL NOT NULL,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_blog_bookmarks_user_post UNIQUE (user_id, post_id),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY(post_id) REFERENCES blog_posts (id) ON DELETE CASCADE
);
CREATE INDEX ix_blog_bookmarks_user_id ON blog_bookmarks (user_id);
CREATE INDEX ix_blog_bookmarks_post_id ON blog_bookmarks (post_id);
UPDATE alembic_version SET version_num='a9b8c7d6e5f4' WHERE alembic_version.version_num = '8e2b4c6d1f30';
COMMIT;
```
2단계에서 설계한 SQL 과 같은지 비교한다. **운영에 나갈 마이그레이션은 항상 이렇게 SQL 을 한 번 눈으로 본다.**

## 4-5. 적용하고 확인

```bash
uv run alembic upgrade head
uv run alembic current           # a9b8c7d6e5f4 (head)
```

DB 에서 직접 확인 (DataGrip 이나 psql):
```bash
psql "postgresql://stock_user:stock_password@localhost:5432/stock_db" -c '\d blog_bookmarks'
```
컬럼 4개, PK, UNIQUE, FK 2개, 인덱스 2개가 보이면 성공.

## 4-6. 되돌리기 연습 (로컬에서 꼭 한 번)

```bash
uv run alembic downgrade -1      # 한 단계 뒤로 → blog_bookmarks 삭제
uv run alembic current           # 8e2b4c6d1f30
uv run alembic upgrade head      # 다시 앞으로
```
downgrade 가 깔끔하게 되는지 확인하는 것이 마이그레이션 검증의 일부다.

## 4-7. 사고 예방 규칙

| 규칙 | 이유 |
|---|---|
| `.env.development` 가 터널(15432)을 보면 로컬 upgrade 금지 | 개발서버 DB 가 바뀐다 |
| 한 번 `main` 에 나간 마이그레이션 파일은 **고치지 않는다** | 이미 적용된 DB 는 다시 실행하지 않는다. 고칠 게 있으면 **새 파일**을 추가 |
| 데이터가 있는 테이블에 `NOT NULL` 컬럼 추가 시 `server_default` 함께 | 기존 행에 넣을 값이 없으면 실패 |
| 컬럼 삭제·이름 변경은 두 번의 배포로 나눔 | 구버전 서버·앱이 아직 그 컬럼을 쓴다 |
| 운영 DB 마이그레이션은 되돌리지 않는 것이 원칙 | `docs/deploy/prod-release.md` "롤백" 참고 |
| 두 사람이 같은 `down_revision` 으로 만들면 head 가 2개 | `alembic heads` 로 확인, `alembic merge` 또는 한쪽 `down_revision` 수정 |

## 체크

- [ ] `alembic heads` 와 `alembic current` 의 차이를 안다.
- [ ] `--sql` 로 적용 전 SQL 을 볼 수 있다.
- [ ] upgrade → downgrade → upgrade 를 직접 해 봤다.

← [3. 모델](./03-model.md) · 다음: [5. 응답 스키마 →](./05-schema.md)

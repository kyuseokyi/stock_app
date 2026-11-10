# 3단계. SQLAlchemy 모델 — 파이썬 클래스로 테이블 표현하기

> 목표: 2단계 설계를 `backend/shared/models.py` 의 클래스로 옮기고, 각 줄이 테이블의 무엇에 해당하는지 안다.

## 3-1. 어디에 쓰나

`backend/shared/models.py` **맨 아래**에 추가한다. 이 파일은 모든 서비스가 같이 쓰는 테이블 정의가 모인 곳이다.
(게임 테이블은 `game_models.py`, 시장 테이블은 `market_models.py` 처럼 영역별로 나뉘어 있다. 북마크는 게시판 영역이라 `models.py`.)

## 3-2. 코드

```python
class BlogBookmark(Base):
    """게시글 북마크(저장). 한 사용자는 같은 글을 한 번만 저장할 수 있다."""

    __tablename__ = "blog_bookmarks"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_blog_bookmarks_user_post"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    post_id: Mapped[int] = mapped_column(
        ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

`Integer`, `ForeignKey`, `UniqueConstraint`, `DateTime`, `func` 와 `datetime` 은 파일 맨 위에서 이미 import 되어 있으므로 추가 import 는 필요 없다.

## 3-3. 한 줄씩 — 2단계 설계와 대응

| 코드 | 의미 | 2단계 설계 |
|---|---|---|
| `class BlogBookmark(Base)` | `Base` 를 물려받아야 SQLAlchemy 가 "테이블"로 인식 | — |
| `__tablename__ = "blog_bookmarks"` | 실제 DB 테이블 이름 | 2-4 |
| `__table_args__ = (UniqueConstraint(...),)` | 여러 컬럼에 걸친 제약조건. 끝의 `,` 는 "튜플" 표시라 꼭 필요 | 2-3 UNIQUE |
| `Mapped[int]` | 파이썬에서 이 값의 타입 (타입 힌트) | |
| `mapped_column(Integer, primary_key=True, autoincrement=True)` | 정수 PK, 자동 증가 | 2-3 PK |
| `ForeignKey("users.id", ondelete="CASCADE")` | `users` 테이블 `id` 를 가리키는 FK, 부모 삭제 시 같이 삭제 | 2-3 FK |
| `nullable=False` | 비어 있으면 안 됨 (`NOT NULL`) | 2-2 |
| `index=True` | 이 컬럼에 인덱스 생성 | 2-3 인덱스 |
| `DateTime(timezone=True)` | 시간대 포함 시각 (`timestamptz`) | 2-2 |
| `server_default=func.now()` | 값을 안 넣으면 **DB 가** 현재 시각을 넣음 | 2-2 |

### `default=` 와 `server_default=` 의 차이
- `default=...` : **파이썬이** 값을 채워서 INSERT 한다.
- `server_default=...` : **DB 가** 값을 채운다. 테이블 정의(DDL)에 `DEFAULT now()` 로 남기 때문에, 파이썬을 거치지 않고 SQL 로 넣어도 적용된다. 시각은 DB 시계를 기준으로 하는 게 안전해서 프로젝트 전체가 `server_default=func.now()` 를 쓴다.

## 3-4. relationship 은 왜 안 넣었나

`BlogComment` 에는 `post: Mapped["BlogPost"] = relationship(...)` 이 있어서 `comment.post.title` 처럼 쓸 수 있다.
북마크는 일부러 넣지 않았다.
- 넣으려면 `User`·`BlogPost` 클래스에도 짝(`back_populates`)을 추가해야 해서, **기존 모델을 건드리게 된다**(프로젝트 규칙: 기존 코드는 최소한으로).
- 목록 조회는 6단계에서 **명시적 join** 으로 제목을 가져온다. 무엇을 조회하는지 코드에 다 보여서 초보자에게도 읽기 쉽다.

## 3-5. 이 단계만으로는 DB 에 아무 일도 안 일어난다

모델을 추가해도 **DB 테이블은 아직 없다.** 모델은 "설계도"이고, 실제 공사는 다음 단계 Alembic 이 한다.

확인해 보기:
```bash
cd backend
uv run python -c "from shared.models import BlogBookmark; print(BlogBookmark.__table__.c.keys())"
# ['id', 'user_id', 'post_id', 'created_at']  ← 설계도는 잘 읽힌다
```

## 체크

- [ ] 모델의 각 줄을 2단계 표의 어느 칸과 연결되는지 짚을 수 있다.
- [ ] `default` 와 `server_default` 의 차이를 안다.
- [ ] "모델만 추가하면 테이블이 생긴다"가 틀린 이유를 안다.

← [2. 테이블 설계](./02-table-design.md) · 다음: [4. Alembic 마이그레이션 →](./04-migration.md)

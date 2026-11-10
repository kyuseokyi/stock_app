# 2단계. 테이블 설계 — 무엇을 어떻게 저장할까

> 목표: 1단계 요구사항을 PostgreSQL 테이블 하나로 옮긴다. 컬럼·타입·키·제약조건을 왜 그렇게 정하는지 하나씩 이해한다.

## 2-1. 저장해야 할 사실

북마크 1건 = "**누가(user)** **어느 글(post)** 을 **언제(created_at)** 저장했다".

## 2-2. 컬럼 정하기

| 컬럼 | 타입 | NULL 허용 | 설명 |
|---|---|---|---|
| `id` | 정수 (자동 증가) | ✗ | 행 고유 번호 (**PK**) |
| `user_id` | 정수 | ✗ | 저장한 사람 → `users.id` (**FK**) |
| `post_id` | 정수 | ✗ | 저장한 글 → `blog_posts.id` (**FK**) |
| `created_at` | 시각 (시간대 포함) | ✗ | 저장한 시각. DB 가 `now()` 로 자동 입력 |

### 왜 이렇게 정했나
- **글 제목을 여기 저장하지 않는다.** 제목은 `blog_posts` 에 이미 있다. 여기 복사해 두면 글 제목이 바뀔 때 두 곳을 고쳐야 한다. 필요하면 조회할 때 **조인(join)** 으로 가져온다(6단계).
- **`updated_at` 이 없다.** 북마크는 만들고 지우기만 하지 수정하지 않는다. 다른 테이블들이 쓰는 `TimestampMixin`(created_at + updated_at)을 쓰지 않고 `created_at` 만 직접 둔다.
- **시간대 포함 시각(`timestamptz`)** 을 쓴다. 프로젝트 전체가 `DateTime(timezone=True)` 를 쓴다. 서버가 어느 나라 시간으로 돌든 같은 순간을 가리킨다.

## 2-3. 키와 제약조건

### PK (기본키) — `id`
행을 하나로 콕 집는 번호. 자동 증가(`SERIAL`).

### FK (외래키) — `user_id`, `post_id`
"이 번호는 반드시 저 테이블에 실제로 있는 번호여야 한다"는 약속. 없는 글 번호로 저장하려 하면 **DB 가 거부**한다(코드에서 놓쳐도 마지막 방어선).

삭제될 때 동작(**ON DELETE**)을 정해야 한다. 요구사항 7번:

| FK | 부모가 지워지면 | 선택 |
|---|---|---|
| `post_id → blog_posts.id` | 글이 지워지면 북마크도 의미 없음 | `CASCADE` (같이 삭제) |
| `user_id → users.id` | 회원 탈퇴하면 북마크도 삭제 | `CASCADE` (같이 삭제) |

> 비교: `blog_posts.author_id` 는 `SET NULL` 이다. 회원이 탈퇴해도 **글은 남겨야** 하기 때문이다. 같은 "회원 삭제"라도 데이터 성격에 따라 답이 다르다.

### UNIQUE — `(user_id, post_id)`
요구사항 2번 "같은 글을 두 번 저장해도 하나만". 코드로도 막지만(7단계), **DB 에도 규칙을 걸어 두면** 동시에 두 요청이 와도 절대 두 줄이 생기지 않는다. 이름은 프로젝트 관례대로 `uq_<테이블>_<컬럼>`: `uq_blog_bookmarks_user_post`.

### 인덱스 — `user_id`, `post_id`
- `user_id` 인덱스: "내 북마크 목록"(`WHERE user_id = ?`)을 빠르게.
- `post_id` 인덱스: 글이 삭제될 때 CASCADE 로 해당 북마크를 찾는 속도를 위해.
- 인덱스는 책 뒤의 색인이다. 없으면 DB 가 처음부터 끝까지 다 읽는다(행이 많아질수록 느려짐).

## 2-4. 테이블 이름

복수형·소문자·밑줄. 같은 영역 테이블과 접두사를 맞춘다: `blog_posts`, `blog_comments` → **`blog_bookmarks`**.

## 2-5. 완성된 설계를 SQL 로 보면

4단계에서 Alembic 이 실제로 만들어 낼 SQL 이다(직접 실행하지는 않는다).

```sql
CREATE TABLE blog_bookmarks (
    id         SERIAL NOT NULL,
    user_id    INTEGER NOT NULL,
    post_id    INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_blog_bookmarks_user_post UNIQUE (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES blog_posts (id) ON DELETE CASCADE
);
CREATE INDEX ix_blog_bookmarks_user_id ON blog_bookmarks (user_id);
CREATE INDEX ix_blog_bookmarks_post_id ON blog_bookmarks (post_id);
```

## 2-6. 관계 그림

```
users (1) ──────< blog_bookmarks >────── (1) blog_posts
  id  ◀── user_id              post_id ──▶  id
```
- 한 사용자는 북마크 여러 개, 한 글도 여러 사람에게 저장될 수 있다 → 사용자와 글의 **다대다(N:M)** 관계를 `blog_bookmarks` 가 **연결 테이블**로 풀어 준다.

## 체크

- [ ] 제목 컬럼을 넣지 않은 이유를 설명할 수 있다.
- [ ] `CASCADE` 와 `SET NULL` 을 언제 쓰는지 예를 들 수 있다.
- [ ] UNIQUE 를 코드와 DB 두 곳에서 지키는 이유를 안다.

← [1. 설계](./01-design.md) · 다음: [3. SQLAlchemy 모델 →](./03-model.md)

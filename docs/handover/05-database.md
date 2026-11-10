# 5. 데이터베이스 — PostgreSQL · ClickHouse · Redis

> 목표: 어떤 데이터가 어느 DB 에 있는지 알고, GUI 툴로 직접 조회해 보고, 테이블을 바꿀 때 Alembic 을 안전하게 쓸 수 있다.

## 5-1. 왜 DB 가 3개인가

| | PostgreSQL | ClickHouse | Redis |
|---|---|---|---|
| 한 줄 설명 | 일반적인 관계형 DB | 분석용 열(column) 저장 DB | 메모리 저장소 |
| 잘하는 것 | 정확한 저장·수정·삭제, 테이블 간 관계 | 수천만 행을 빠르게 집계 | 아주 빠른 읽기/쓰기, 메시지 전달 |
| 못하는 것 | 수억 행 시계열 집계는 느림 | 한 행씩 수정·삭제 | 큰 데이터 영구 보관 |
| 이 프로젝트에서 | 회원·글·댓글·게임 계좌·테마 등 | 전종목 일봉·지표·스크리너 결과 | 캐시, 실시간 시세, Celery 큐, 알림 전달 |
| 스키마 관리 | **Alembic** (`backend/alembic/`) | 코드로 생성 (`shared/clickhouse_schema.py`) | 스키마 없음(키-값) |
| 로컬 접속 | `localhost:5432` | `localhost:8123`(HTTP) | `localhost:6379` |

로컬 접속 계정(`docker-compose.dev.yml` 기준):

| DB | User | Password | Database |
|---|---|---|---|
| PostgreSQL | `stock_user` | `stock_password` | `stock_db` |
| ClickHouse | `default` | `password` | `stock_data` |
| Redis | — | 없음 | `0` |

> ⚠️ 위 비밀번호는 **로컬 전용**이다. 운영 비밀번호는 서버의 `.env.production` 에만 있고 Git 에는 없다.
> DataGrip/DBeaver 로 붙는 방법, 개발서버 DB 에 터널로 붙는 방법은 [`docs/db_access.md`](../db_access.md).

## 5-2. 관계형 DB 기초 용어 (PostgreSQL)

| 용어 | 뜻 | 예 |
|---|---|---|
| 테이블 | 엑셀 시트 하나 | `blog_comments` |
| 행(row) | 한 줄 = 데이터 1건 | 댓글 하나 |
| 컬럼(column) | 열 = 항목 | `content`, `created_at` |
| 기본키(PK) | 행을 구분하는 고유 번호 | `id` |
| 외래키(FK) | 다른 테이블 행을 가리키는 번호 | `blog_comments.post_id` → `blog_posts.id` |
| 인덱스 | 책의 색인. 검색을 빠르게 | `post_id` 에 인덱스 |
| `ON DELETE CASCADE` | 부모가 지워지면 자식도 같이 삭제 | 글을 지우면 댓글도 삭제 |
| `ON DELETE SET NULL` | 부모가 지워지면 자식의 FK 를 비움 | 회원 탈퇴해도 글은 남고 작성자만 비움 |

### 핵심 테이블 관계 (게시판 영역)

```
users ─┬─< blog_posts >── boards           (─< 는 "하나에 여러 개")
       │        │
       └─< blog_comments >┘
users ─< push_devices        users ─< user_sessions        users ─< refresh_tokens
```

### PostgreSQL 테이블 지도

| 영역 | 테이블 | 정의 파일 |
|---|---|---|
| 회원·인증 | `users`, `user_sessions`, `refresh_tokens` | `shared/models.py` |
| 게시판 | `boards`, `blog_posts`, `blog_comments` | `shared/models.py` |
| 알림·앱 | `push_devices`, `push_sends`, `push_templates`, `app_version_configs` | `shared/models.py` |
| 종목 기본 | `stock_meta` | `shared/models.py` |
| 트레이딩 게임 | `game_seasons`, `game_accounts`, `game_positions`, `game_trades`, `hall_of_fame`, `game_coach_messages`, 퀘스트·뱃지·퀴즈·출석·랭킹·설정 테이블 | `shared/game_models.py` |
| 시장 참조 | `stock_profile`, `sectors`, `themes`, `theme_stocks`, `stock_events`, `screener_features` | `shared/market_models.py` |
| AI 시황 | `ai_daily_briefings`, `ai_stock_evaluations` | `shared/ai_models.py` |

## 5-3. 파이썬에서 테이블 다루기 — SQLAlchemy

코드에서는 SQL 을 직접 쓰지 않고 **파이썬 클래스(모델)** 로 다룬다. 이것을 ORM 이라 한다.

```python
# shared/models.py — 테이블 정의
class BlogComment(Base, TimestampMixin):
    __tablename__ = "blog_comments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    post: Mapped["BlogPost"] = relationship(back_populates="comments")   # comment.post 로 글 객체 접근
    author: Mapped["User"] = relationship(back_populates="comments")
```

| 하고 싶은 것 | SQL | SQLAlchemy (async) |
|---|---|---|
| 1건 조회 | `SELECT * FROM users WHERE id=1` | `await db.get(User, 1)` |
| 목록 | `SELECT * FROM blog_comments WHERE post_id=12 ORDER BY id` | `(await db.execute(select(BlogComment).where(BlogComment.post_id == 12).order_by(BlogComment.id))).scalars().all()` |
| 추가 | `INSERT INTO ...` | `db.add(obj); await db.commit()` |
| 수정 | `UPDATE ...` | `obj.content = "새 내용"; await db.commit()` |
| 삭제 | `DELETE ...` | `await db.delete(obj); await db.commit()` |

> **commit 을 해야 저장된다.** `db.add()` 만 하고 `commit()` 을 빼먹으면 요청이 끝날 때 버려진다.

## 5-4. 테이블 바꾸기 — Alembic 마이그레이션

모델(`shared/*models.py`)을 고쳐도 DB 테이블은 자동으로 안 바뀐다. **Alembic** 이 "변경 이력 파일"을 만들어 DB 에 순서대로 적용한다. 이력은 `backend/alembic/versions/` 에 파일 하나씩 쌓인다.

```bash
cd backend
# 1) 모델 수정 (예: Board 에 description 컬럼 추가)
# 2) 변경 파일 자동 생성
uv run alembic revision --autogenerate -m "boards description"
# 3) 생성된 alembic/versions/xxxx_boards_description.py 를 꼭 열어서 확인 (자동 생성은 틀릴 수 있다)
# 4) 적용
uv run alembic upgrade head
# 현재 DB 가 어느 버전인지
uv run alembic current
# 바로 전 단계로 되돌리기 (운영에선 신중히)
uv run alembic downgrade -1
```

> 새 테이블을 처음부터 만들고 적용·되돌리기까지 해 보는 실습: [실습 4단계 — Alembic 마이그레이션](./api-tutorial/04-migration.md)

**안전 규칙**
- 운영 배포(`deploy-server.yml`)가 **`alembic upgrade head` 를 자동으로** 돌린다. 그래서 마이그레이션 파일은 운영 DB 에 그대로 실행된다고 생각하고 쓴다.
- 이미 데이터가 있는 테이블에 `NOT NULL` 컬럼을 추가할 때는 `server_default` 를 같이 준다(기존 행 값이 필요하다).
- 컬럼 삭제·이름 변경은 구버전 앱/서버가 아직 쓰고 있을 수 있다. 먼저 코드에서 안 쓰게 배포한 뒤, 다음 배포에서 지운다.
- 새 모델 파일을 만들었다면 `alembic/env.py` 에 `import` 해야 autogenerate 가 인식한다(`shared.game_models` 등이 그렇게 등록돼 있다).
- 로컬이 개발서버 DB(터널 15432)를 보고 있으면, 로컬에서 `upgrade` 하는 순간 **개발서버 DB 가 바뀐다.**

## 5-5. ClickHouse — 주가 시계열 창고

### 주요 테이블 (`stock_data` DB)

| 테이블 | 내용 | 만드는 곳 |
|---|---|---|
| `daily_prices` | 전종목 일봉 OHLCV + 이동평균(MA5/20/50/120)·볼린저·RSI·MACD | `shared/clickhouse_schema.py` |
| `fundamentals`, `fundamentals_periodic` | 재무 지표(PER·PBR·EPS 등) | 같은 파일 / `collector/repositories/clickhouse_market.py` |
| `market_index_daily`, `investor_daily`, `macro_series` | 지수, 투자자별 매매, 거시 지표(FRED) | `collector/repositories/clickhouse_market.py` |
| `canslim_daily`, `canslim_market` | CANSLIM 점수(주도주 화면) | `collector/repositories/clickhouse_canslim.py` |
| `market_group_daily`, `market_stock_daily` | 테마·업종별 집계, 종목별 시장 지표 | `collector/repositories/clickhouse_market_groups.py` |
| `screener_daily` | 조건검색용 계산값 | `collector/repositories/clickhouse_screener.py` |
| `chart_pattern_daily` | 차트 패턴(베이스·돌파) | `collector/repositories/clickhouse_patterns.py` |
| `game_minute_bars` | 게임용 분봉 | `shared/clickhouse_schema.py` |

`uv run python -m shared.clickhouse_schema` 는 `daily_prices`·`fundamentals`·`game_minute_bars` 와 `clickhouse_market.py` 의 테이블을 만든다. 나머지(CANSLIM·시장 그룹·스크리너·패턴)는 **해당 계산 작업이 처음 돌 때** 스스로 만든다. 모두 `CREATE TABLE IF NOT EXISTS` 라 여러 번 실행해도 안전하다(= 멱등).

### 꼭 알아야 할 것: `ReplacingMergeTree` 와 `FINAL`

```sql
ENGINE = ReplacingMergeTree(ingested_at)   -- 같은 (ticker, date) 가 여러 번 들어오면 ingested_at 이 최신인 것만 남긴다
ORDER BY (ticker, date)
```
- 수집을 다시 돌려도(겹쳐 수집) 데이터가 두 배가 되지 않게 하는 장치다.
- 단, 중복 정리는 **나중에 백그라운드로** 일어난다. 그래서 **조회할 때 항상 `FINAL`** 을 붙여야 "날짜당 1행"이 보장된다.

```sql
SELECT date, open, high, low, close, volume
FROM stock_data.daily_prices FINAL
WHERE ticker = '005930'
ORDER BY date DESC
LIMIT 10;
```

### ClickHouse 사용 규칙
- 파이썬에서는 `shared/clickhouse_schema.get_client()` 하나만 쓴다(프로세스당 연결 1개를 재사용 — 연결이 새는 문제를 막으려고).
- 행 단위 수정/삭제는 하지 않는다. 다시 넣으면(재수집) 최신 값이 이긴다.

## 5-6. Redis — 메모장이자 우체통

| 용도 | 예 | 쓰는 곳 |
|---|---|---|
| Celery 작업 대기열(브로커) | "전종목 수집해라" 메시지 | `collector/celery_app.py` |
| 실시간 시세 | `stock:tick:{종목코드}`(발행), `stock:latest:{종목코드}`(최신가) | `run_game_ws` → `trading_game` |
| 서버 → 화면 알림 전달 | 새 글 SSE, 게임 WS 브로드캐스트(`game:ws:broadcast`) | blog `events.py`, trading_game `ws_bus.py` |
| 랭킹 | `game:season:{id}:ranking` (정렬된 집합) | trading_game |
| 로그인 보조 | 소셜 로그인 state·교환 코드, 세션 교체 알림 | auth |
| 캐시·잠금 | 관리자 작업 동시 실행 방지 잠금, 파이프라인 결과 기록 | stock_api, collector |

Redis 는 지워져도 대부분 다시 채워지는 데이터만 둔다. **영구 보관할 데이터는 PostgreSQL/ClickHouse 에 넣는다.**

```bash
docker exec -it stock_redis redis-cli      # 로컬 컨테이너 이름은 docker-compose.dev.yml 의 container_name
> KEYS stock:latest:*        # (로컬에서만! 운영에선 KEYS 대신 SCAN)
> GET stock:latest:005930
```

## 5-7. 데이터 백업

- ClickHouse 백업: [`docs/deployment/clickhouse-backup.md`](../deployment/clickhouse-backup.md)
- 볼륨: `docker compose down` 해도 데이터는 남는다. `down -v` 는 **삭제**.

## 직접 해보기

1. DataGrip(또는 DBeaver)으로 로컬 PostgreSQL 에 붙어 `users`, `boards`, `blog_posts`, `blog_comments` 를 열어 본다.
2. 웹에서 댓글을 하나 달고, `SELECT * FROM blog_comments ORDER BY id DESC LIMIT 5;` 로 방금 쓴 댓글이 보이는지 확인한다.
3. `uv run alembic current` 로 현재 마이그레이션 버전을 보고, `alembic/versions/` 에서 그 파일을 찾아 열어 본다.
4. (데이터가 있다면) ClickHouse 에서 `FINAL` 을 붙인 쿼리와 안 붙인 쿼리의 `count()` 를 비교해 본다.

이전: [4. 서버 구조](./04-server-fastapi.md) · 다음: [6. API](./06-api.md)

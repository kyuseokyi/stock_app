# 트레이딩 게임 Phase 1 — DB 스키마 토대 설계 (Spec)

> 작성일: 2026-10-11
> 상위 기획: `docs/trading_game_plan.md` (마스터 기획, 확정)
> 단계 프롬프트: `docs/prompts/trading_game/01_phase1_db_schema.md`
> 대상: `backend/` (PostgreSQL · SQLAlchemy · Alembic)

---

## 1. 개요 & 범위

실시간 트레이딩 게임의 **데이터 토대(핵심 6테이블)** 를 SQLAlchemy ORM으로 정의하고, Alembic
마이그레이션을 적용하며, 개발 시드와 모델 테스트까지 완성한다.

트레이딩 게임 전체는 6개 Phase(마스터 기획 7장)로 분해되며, 이 스펙은 **Phase 1(DB 스키마)만**
다룬다. 서비스/라우터/실시간 WebSocket/주문엔진/프론트는 범위 밖(각 Phase에서 별도 spec→plan).

### 1.1 이 Phase가 산출하는 것
- `backend/shared/game_models.py` — 핵심 6 모델
- `shared/models.py`에서 import하여 `Base.metadata`에 등록(Alembic 자동 감지)
- Alembic 마이그레이션 `create_trading_game_core_tables`
- `backend/scripts/seed_trading_game.py` — 멱등 개발 시드(시즌 1기 + 샘플 코치)
- `backend/tests/test_game_models.py` — 모델/제약 검증(pytest-asyncio)

### 1.2 이 Phase가 하지 않는 것 (명시적 제외)
- 게임 API/서비스/라우터, WebSocket 게이트웨이, 주문·체결 엔진, 랭킹(Redis ZSET)
- 프론트(web_client·mobile)의 게임 화면 — 현재 "시즌 준비 중" 스켈레톤 유지
- 간편로그인(소셜) 연동 — 별개의 Phase 3 작업(아래 5.3 참조)

---

## 2. 확정된 설계 결정

### 2.1 유저 FK 타입 = Integer (기존 스키마 정합)
마스터 기획서는 `user_id`를 UUID FK로 가정했으나, 기존 `shared/models.py`의
`User.id`는 **Integer(autoincrement)** 이다. 따라서:
- **`users.id`를 참조하는 모든 FK는 Integer** — `game_accounts.user_id`, `hall_of_fame.user_id`,
  `game_coach_messages.author_id`.
- 게임 테이블의 **내부 PK는 UUID 유지** — `game_accounts.id`, `game_positions.id`,
  `game_trades.id` (기존 스키마와 충돌 없음, 분산 생성·노출 안전).
- `users` 테이블은 변경하지 않는다(auth·blog·댓글·기존 데이터 무영향).

### 2.2 테이블 범위 = 핵심 트레이딩 6종
교육/소셜 테이블 3종(`chart_quiz_pool`·`user_streaks`·`private_leagues`)은 해당 기능 Phase에서
생성한다(4.에 기록). YAGNI — 테이블은 실제 쓰이는 시점에 만든다.

### 2.3 시즌 기간 = 데이터 주도 유연화 (월/분기/무기한 미확정)
시즌 운영 주기를 **코드/스키마에 하드코딩하지 않는다.** 아직 월간·분기·무기한 중 미정이므로:
- `start_at` **필수**, `end_at` **nullable** → `end_at IS NULL` 이면 **무기한/미정** 시즌.
- `period_type` String(20) **nullable** → 운영 의도 라벨(`'MONTHLY'`/`'QUARTERLY'`/`'OPEN'` 등) 기록용.
  enum으로 고정하지 않아 나중에 정책이 정해지면 값만 쓰면 된다.
- 시즌 자동 정산(Phase 4)은 **`end_at`이 설정된 시즌만** 대상으로 하고, `NULL`이면 수동 종료까지 유지.

### 2.4 금액은 고정소수(Decimal)
모든 자본/손익/가격 컬럼은 `Numeric(…, 2~4)`. 부동소수 반올림 오차가 랭킹·PnL에 누적되는 것을 방지.
시작 자본금은 `INITIAL_CASH = Decimal("10000000")` 상수로 한 곳에 정의하고 재사용(DRY).

### 2.6 데이터 무결성 제약 (Task 1 코드리뷰 반영)
스키마 확정 단계이므로 무결성 제약을 처음부터 건다(나중에 추가하면 또 마이그레이션 필요):
- `game_seasons`: `UniqueConstraint(season_number)` — 기수 중복 방지.
- `hall_of_fame`: `UniqueConstraint(season_id, rank)` + `UniqueConstraint(season_id, user_id)` — 시즌 정산 재실행 시 중복 박제 방지.
- `game_coach_messages`: `UniqueConstraint(season_id, target_date, coach_type)` — 슬롯당 1건(시드 멱등 로직의 전제).
- ORM 부모 관계는 `cascade="all, delete-orphan"` + `passive_deletes=True`로 DB의 `ON DELETE CASCADE`에
  삭제를 위임(자식 NOT NULL 충돌 방지). ※ `passive_deletes=True`만으로는 **이미 로드된** 자식을 ORM이
  `account_id=NULL`로 분리하려다 NOT NULL 위반이 나므로, `cascade="all, delete-orphan"`가 반드시 함께 필요.
- CheckConstraint(side/leverage 범위 등)는 앱 계층 검증에 맡기고 이번 범위에서 제외(과설계 회피).

### 2.5 모델 파일 배치
`backend/shared/game_models.py` 신규 파일. 모델은 `Base` 서브클래스 정의 시점에 `Base.metadata`에
자동 등록되며, Alembic이 감지하도록 **`alembic/env.py`에서 `import shared.game_models`** 한다
(`shared/models.py`는 수정하지 않는다 — 양방향 import 시 순환참조로 "partially initialized module"
에러가 나므로, 의존은 game_models → models 단방향만 유지).
(게임 모델은 미래 게임 서비스·수집 데몬·admin이 공유하므로 `shared/`가 적합. `apps/game`은 시기상조.)

---

## 3. 테이블 스키마 (핵심 6종)

공통: 별도 명시 없으면 `TimestampMixin`(created_at/updated_at) 상속. 시각은 `DateTime(timezone=True)`.

### 3.1 `game_seasons` (시즌 마스터)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | Integer | PK, autoincrement |
| season_number | Integer | NOT NULL |
| ticker | String(20) | NOT NULL (시즌 고정 단일 종목, 예 '005930') |
| stock_name | String(50) | NOT NULL |
| start_at | DateTime(tz) | NOT NULL |
| end_at | DateTime(tz) | **NULL 허용** (NULL=무기한/미정) |
| period_type | String(20) | **NULL 허용** ('MONTHLY'/'QUARTERLY'/'OPEN' 등 라벨) |
| initial_cash | Numeric(15,2) | NOT NULL, default 10000000.00 |
| status | String(20) | NOT NULL, default 'READY' ('READY'/'ACTIVE'/'FINISHED') |
| created_at, updated_at | — | TimestampMixin |
| 제약 | — | `UniqueConstraint(season_number)` = `uq_season_number` |

### 3.2 `game_accounts` (유저 시즌별 가상 계좌)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | UUID | PK, default uuid4 |
| user_id | **Integer** | FK→users.id (ondelete CASCADE) — 별도 index 불필요(아래 UniqueConstraint의 선두 컬럼) |
| season_id | Integer | FK→game_seasons.id (CASCADE), index |
| cash_balance | Numeric(15,2) | default 10000000.00 |
| total_asset | Numeric(15,2) | default 10000000.00 |
| current_roi | Numeric(8,4) | default 0 |
| max_roi | Numeric(8,4) | default 0 |
| total_trades | Integer | default 0 |
| win_trades | Integer | default 0 |
| created_at, updated_at | — | TimestampMixin |
| 제약 | — | `UniqueConstraint(user_id, season_id)` = `uq_user_season_account` |

### 3.3 `game_positions` (활성 포지션)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | UUID | PK, default uuid4 |
| account_id | UUID | FK→game_accounts.id (CASCADE), index |
| side | String(10) | NOT NULL ('LONG'/'SHORT') |
| entry_price | Numeric(12,2) | NOT NULL |
| size_amount | Numeric(15,2) | NOT NULL (진입 투자 원금) |
| leverage | Integer | default 1 (1/2/5) |
| stop_loss_price | Numeric(12,2) | NULL |
| take_profit_price | Numeric(12,2) | NULL |
| status | String(20) | default 'OPEN' ('OPEN'/'CLOSED') |
| created_at, updated_at | — | TimestampMixin |

### 3.4 `game_trades` (청산 완료 내역)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | UUID | PK, default uuid4 |
| account_id | UUID | FK→game_accounts.id (CASCADE), index |
| position_id | UUID | NULL (원 포지션 참조, 감사용) |
| side | String(10) | NOT NULL |
| entry_price | Numeric(12,2) | NOT NULL |
| exit_price | Numeric(12,2) | NOT NULL |
| pnl_amount | Numeric(15,2) | NOT NULL (실현 손익금) |
| roi_pct | Numeric(8,4) | NOT NULL (실현 수익률 %) |
| closed_reason | String(20) | NOT NULL ('MANUAL'/'TAKE_PROFIT'/'STOP_LOSS'/'SEASON_END'/'MARGIN_CALL') |
| closed_at | DateTime(tz) | server_default now() |

### 3.5 `hall_of_fame` (명예의 전당)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | Integer | PK, autoincrement |
| season_id | Integer | FK→game_seasons.id (CASCADE), index |
| rank | Integer | NOT NULL (1~100) |
| user_id | **Integer** | FK→users.id (**SET NULL**), **nullable**, index (영구 박제 — 유저 삭제돼도 기록 보존) |
| user_nickname | String(50) | NOT NULL (비정규화, 유저 삭제 대비) |
| final_roi | Numeric(8,4) | NOT NULL |
| final_asset | Numeric(15,2) | NOT NULL |
| win_rate | Numeric(5,2) | NOT NULL |
| trading_mbti | String(50) | NULL (예 '냉철한 원칙주의자') |
| created_at | DateTime(tz) | server_default now() |
| 제약 | — | `UniqueConstraint(season_id, rank)` + `UniqueConstraint(season_id, user_id)` |

### 3.6 `game_coach_messages` (관리자 스마트 코치)
| 컬럼 | 타입 | 제약/기본 |
|---|---|---|
| id | Integer | PK, autoincrement |
| season_id | Integer | FK→game_seasons.id (CASCADE), index |
| target_date | Date | NOT NULL, index |
| coach_type | String(20) | NOT NULL ('MORNING'/'EVENING'/'IN_PLAY') |
| title | String(100) | NOT NULL |
| summary_nudge | String(200) | NOT NULL (차트 상단 1줄 롤링) |
| content_md | Text | NOT NULL |
| support_price | Numeric(12,2) | NULL (추천 지지선) |
| resistance_price | Numeric(12,2) | NULL (추천 저항선) |
| published_at | DateTime(tz) | server_default now() |
| author_id | **Integer** | FK→users.id (**SET NULL**), NULL 허용 |
| 제약 | — | `UniqueConstraint(season_id, target_date, coach_type)` = `uq_coach_slot` |

### 3.7 관계(Relationship) — 최소한만
- `GameAccount.positions` ↔ `GamePosition.account`
- `GameAccount.trades` ↔ `GameTrade.account`
- `GameSeason.accounts` ↔ `GameAccount.season`
(테스트 편의 및 캐스케이드 명확화 목적. 과한 양방향 관계는 지양.)

---

## 4. 추후 Phase로 연기(기록)

아래는 이번 범위에서 **만들지 않으며**, 해당 기능 Phase에서 별도 spec→plan→마이그레이션으로 추가한다.
(컬럼 명세는 `docs/trading_game_plan.md` 6.7~6.9 참조.)

| 테이블 | 용도 | 생성 시점 |
|---|---|---|
| `chart_quiz_pool` | 야간 10초 차트 패턴 퀴즈 | Phase 5 (교육) |
| `user_streaks` | 연속 출석/습관 | Phase 5 (교육) |
| `private_leagues` (+ `private_league_members`) | 지인 리그 | Phase 5 (소셜) — user_id/owner_id는 **Integer FK**로 생성할 것 |

**서비스 배치 결정도 연기**: 게임 API 서비스(신규 `apps/game`, 포트 예: 8003)와 KIS 실시간
WebSocket 수집 데몬의 위치/프로세스 형태는 Phase 2~3 설계에서 확정한다. Phase 1은 서비스 없이
모델만 `shared/`에 둔다.

---

## 5. 컨텍스트 & 의존성

### 5.1 Alembic
`alembic/env.py`는 `target_metadata = Base.metadata`. `env.py`에서 `import shared.game_models` 하면
(게임 모델이 `Base.metadata`에 등록되어) 자동 감지된다. 기존 마이그레이션 5개가 head에 적용돼 있음.

### 5.2 테스트
`pyproject.toml`에 `pytest`·`pytest-asyncio` + `[tool.pytest.ini_options]` 구성됨. 기존 백엔드
테스트 5종(`tests/`) 패턴을 따른다. (web_client과 달리 백엔드는 테스트 러너가 있음.)

### 5.3 유저 식별 & 간편로그인 (현황)
- `users` 테이블은 이미 소셜 필드 보유: `provider`(KAKAO/GOOGLE/APPLE), `provider_id`, `social_token`.
  단 **엔드포인트/프론트는 미구현** — 현재 로그인은 `/api/v1/auth/login`(관리자), `/guest`(닉네임)뿐.
- 간편로그인 실연동은 **Phase 3 별개 작업**. 게임은 현재 게스트 유저(Integer `users.id`)를 그대로
  참조하며, 추후 소셜 로그인이 붙어도 동일 `users.id`를 쓰므로 **게임 스키마 변경 불필요**.

---

## 6. 시드 (`backend/scripts/seed_trading_game.py`, 멱등)
- **시즌 1기** 생성: `ticker='005930'`, `stock_name='삼성전자'`, `start_at`=당월 1일 09:00(KST),
  `end_at=NULL`(기간 미정/무기한), `period_type=NULL`, `status='ACTIVE'`.
  재실행 시 `season_number=1` 존재하면 건너뜀(멱등).
- **샘플 코치 메시지 1건**: `coach_type='MORNING'`, `support_price=71000`, `resistance_price=73500`,
  간단한 `summary_nudge`·`content_md`.
- **차트 퀴즈 시딩 없음** — `chart_quiz_pool`이 Phase 5로 연기되므로 제외.
- 실행: `uv run python -m scripts.seed_trading_game`

> 참고: 시즌 기간이 미정이므로 시드는 `end_at=NULL`로 둔다. 운영 정책(월/분기/무기한)이 정해지면
> 관리자 기능 또는 시드 파라미터로 `end_at`·`period_type`을 지정한다.

---

## 7. 테스트 (`backend/tests/test_game_models.py`)
pytest-asyncio로 다음을 검증:
1. `GameSeason` 생성 — `end_at=NULL`(무기한) 및 값 지정 둘 다 가능.
2. `GameAccount` 발급 — 동일 (user_id, season_id) 중복 시 `UniqueConstraint` 위반 발생.
3. `GamePosition` 오픈 — account FK 연결, side/leverage 저장.
4. FK 제약 — 존재하지 않는 season_id/user_id로 생성 시 무결성 오류.
5. 유저 FK가 **Integer**로 생성됐는지(기존 users.id와 정합) 확인.

---

## 8. 검증 기준 (Definition of Done)
- [ ] `game_models.py` 6 모델 정의 + `alembic/env.py`에서 `import shared.game_models` 등록
- [ ] `alembic revision --autogenerate` 결과가 **신규 6테이블 create만** 포함(기존 테이블 alter/drop 없음) — 수동 검토
- [ ] `alembic upgrade head` 성공, 롤백(`downgrade`) 스크립트도 유효
- [ ] 시드 실행 → 시즌 1기 + 코치 1건, 재실행 멱등
- [ ] `pytest tests/test_game_models.py -v` 전부 통과
- [ ] 기존 테스트(blog/auth 등) 회귀 없음

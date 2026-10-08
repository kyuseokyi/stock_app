[명령어: 이 작업은 `backend/` 디렉토리 안에서 수행하세요. 사전에 `docs/prompts/00_master_prompt.md`, `CLAUDE.md`, `docs/trading_game_plan.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 **실시간 트레이딩 게임 (Trading Game)**의 기반이 되는 PostgreSQL 데이터베이스 스키마를 SQLAlchemy ORM으로 정의하고, Alembic 마이그레이션을 생성/적용하며, 초기 시즌 및 퀴즈 시딩 스크립트를 구현하는 것입니다.

---

## 1. 구현 대상 테이블 및 명세

`docs/trading_game_plan.md` 6장에 정의된 테이블 명세를 엄격히 준수하세요.
기존 `backend/shared/models.py`의 `Base`, `TimestampMixin`을 상속받아 구현하거나, 가독성을 위해 `backend/shared/game_models.py`로 분리한 후 `models.py`에서 `Base.metadata`에 포함되도록 임포트하세요.

### 1) `game_seasons` (시즌 마스터)
- `id`: Integer, PK, autoincrement
- `season_number`: Integer, nullable=False (예: 1)
- `ticker`: String(20), nullable=False (시즌 대표 단일 종목, 예: '005930')
- `stock_name`: String(50), nullable=False (예: '삼성전자')
- `start_at`: DateTime(timezone=True), nullable=False
- `end_at`: DateTime(timezone=True), nullable=False
- `initial_cash`: BigInteger/Numeric, default=10000000 (시작 자본금 1천만 원)
- `status`: String(20), default='READY' ('READY', 'ACTIVE', 'FINISHED')
- `created_at`, `updated_at`: TimestampMixin

### 2) `game_accounts` (유저 시즌별 가상 계좌)
- `id`: UUID (as_uuid=True), PK, default=uuid4
- `user_id`: UUID, ForeignKey('users.id', ondelete='CASCADE'), index=True
- `season_id`: Integer, ForeignKey('game_seasons.id', ondelete='CASCADE'), index=True
- `cash_balance`: Numeric(15, 2), default=10000000.00
- `total_asset`: Numeric(15, 2), default=10000000.00
- `current_roi`: Numeric(8, 4), default=0.0000
- `max_roi`: Numeric(8, 4), default=0.0000
- `total_trades`: Integer, default=0
- `win_trades`: Integer, default=0
- `created_at`, `updated_at`: TimestampMixin
- *Constraint*: `UniqueConstraint('user_id', 'season_id', name='uq_user_season_account')`

### 3) `game_positions` (활성 포지션)
- `id`: UUID, PK, default=uuid4
- `account_id`: UUID, ForeignKey('game_accounts.id', ondelete='CASCADE'), index=True
- `side`: String(10), nullable=False ('LONG' 또는 'SHORT')
- `entry_price`: Numeric(12, 2), nullable=False
- `size_amount`: Numeric(15, 2), nullable=False (진입 투자 원금)
- `leverage`: Integer, default=1 (1, 2, 5)
- `stop_loss_price`: Numeric(12, 2), nullable=True
- `take_profit_price`: Numeric(12, 2), nullable=True
- `status`: String(20), default='OPEN' ('OPEN', 'CLOSED')
- `created_at`, `updated_at`: TimestampMixin

### 4) `game_trades` (청산 완료 거래 내역)
- `id`: UUID, PK, default=uuid4
- `account_id`: UUID, ForeignKey('game_accounts.id', ondelete='CASCADE'), index=True
- `position_id`: UUID, nullable=True
- `side`: String(10), nullable=False ('LONG' / 'SHORT')
- `entry_price`: Numeric(12, 2), nullable=False
- `exit_price`: Numeric(12, 2), nullable=False
- `pnl_amount`: Numeric(15, 2), nullable=False (실현 손익금)
- `roi_pct`: Numeric(8, 4), nullable=False (실현 수익률 %)
- `closed_reason`: String(20), nullable=False ('MANUAL', 'TAKE_PROFIT', 'STOP_LOSS', 'SEASON_END', 'MARGIN_CALL')
- `closed_at`: DateTime(timezone=True), server_default=func.now()

### 5) `hall_of_fame` (명예의 전당 아카이브)
- `id`: Integer, PK, autoincrement
- `season_id`: Integer, ForeignKey('game_seasons.id', ondelete='CASCADE'), index=True
- `rank`: Integer, nullable=False (1~100)
- `user_id`: UUID, ForeignKey('users.id', ondelete='CASCADE')
- `user_nickname`: String(50), nullable=False
- `final_roi`: Numeric(8, 4), nullable=False
- `final_asset`: Numeric(15, 2), nullable=False
- `win_rate`: Numeric(5, 2), nullable=False
- `trading_mbti`: String(50), nullable=True (예: '냉철한 원칙주의자')
- `created_at`: DateTime(timezone=True), server_default=func.now()

### 6) `game_coach_messages` (관리자 스마트 코치 브리핑)
- `id`: Integer, PK, autoincrement
- `season_id`: Integer, ForeignKey('game_seasons.id', ondelete='CASCADE'), index=True
- `target_date`: Date, nullable=False, index=True
- `coach_type`: String(20), nullable=False ('MORNING', 'EVENING', 'IN_PLAY')
- `title`: String(100), nullable=False
- `summary_nudge`: String(200), nullable=False (차트 상단 1줄 롤링 배너)
- `content_md`: Text, nullable=False
- `support_price`: Numeric(12, 2), nullable=True (추천 지지선)
- `resistance_price`: Numeric(12, 2), nullable=True (추천 저항선)
- `published_at`: DateTime(timezone=True), server_default=func.now()
- `author_id`: UUID, ForeignKey('users.id', ondelete='SET NULL'), nullable=True

### 7) `chart_quiz_pool` (야간/주말 10초 차트 패턴 퀴즈 풀)
- `id`: Integer, PK, autoincrement
- `ticker`: String(20), nullable=False
- `pattern_type`: String(50), nullable=False ('망치형캔들', '이중바닥', '헤드앤숄더', '골든크로스' 등)
- `chart_snapshot`: JSON/JSONB, nullable=False (가려진 시점까지의 OHLCV 리스트)
- `answer`: String(10), nullable=False ('UP' 또는 'DOWN')
- `actual_change`: Numeric(6, 2), nullable=False
- `explanation`: Text, nullable=False
- `reward_cash`: Integer, default=200000

### 8) `user_streaks` (연속 출석 및 참여 데이터)
- `user_id`: UUID, ForeignKey('users.id', ondelete='CASCADE'), PK
- `current_streak`: Integer, default=0
- `highest_streak`: Integer, default=0
- `last_activity_date`: Date, nullable=True
- `updated_at`: DateTime(timezone=True), onupdate=func.now()

### 9) `private_leagues` (지인 리그) & `private_league_members`
- `private_leagues`:
  - `id`: UUID, PK, default=uuid4
  - `season_id`: Integer, ForeignKey('game_seasons.id', ondelete='CASCADE'), index=True
  - `league_name`: String(50), nullable=False
  - `owner_id`: UUID, ForeignKey('users.id', ondelete='CASCADE')
  - `invite_code`: String(10), unique=True, index=True
  - `created_at`: DateTime(timezone=True), server_default=func.now()
- `private_league_members`:
  - `league_id`: UUID, ForeignKey('private_leagues.id', ondelete='CASCADE'), PK
  - `user_id`: UUID, ForeignKey('users.id', ondelete='CASCADE'), PK
  - `joined_at`: DateTime(timezone=True), server_default=func.now()

---

## 2. 작업 순서 (Step by Step)

1. **모델 파일 생성**:
   - `backend/shared/game_models.py` 파일을 생성하고 위 모델들을 정의하세요.
   - `backend/shared/models.py`에서 `game_models`의 엔티티들을 import하여 Alembic metadata에 등록되도록 연결하세요.
2. **Alembic 환경 확인 및 마이그레이션 생성**:
   - `backend/alembic/env.py`에서 `target_metadata`에 신규 모델들이 정상 포함되었는지 확인하세요.
   - 다음 명령어로 마이그레이션 스크립트를 자동 생성하세요:
     ```bash
     uv run alembic revision --autogenerate -m "create_trading_game_tables"
     ```
   - 생성된 마이그레이션 파일을 검토하여 불필요한 기존 테이블 drop/alter가 없는지 확인하세요. (Regression 방지!)
3. **마이그레이션 적용**:
   ```bash
   uv run alembic upgrade head
   ```
4. **시딩 스크립트 작성 (`backend/scripts/seed_trading_game.py`)**:
   - '시즌 1기' (종목: `005930`, 삼성전자, 이번 달 1일~말일, 상태 `ACTIVE`) 자동 생성
   - 관리자 데일리 코칭 샘플 메시지 1개 생성 (모닝 브리핑, 지지선 71000, 저항선 73500)
   - 기초 차트 퀴즈 풀 최소 5~10개 문항 샘플 JSON과 함께 시딩
   - 실행:
     ```bash
     uv run python -m scripts.seed_trading_game
     ```
5. **검증 테스트 작성 (`backend/tests/test_game_models.py`)**:
   - `pytest`를 활용하여 `GameSeason` 생성, `GameAccount` 발급, `GamePosition` 오픈 및 Foreign Key 제약 조건이 정상 동작하는지 테스트 작성 및 통과 확인:
     ```bash
     uv run pytest tests/test_game_models.py -v
     ```

# 교육용 합성 종가 트레이딩 게임 기획 및 클로드코드 구현 명세서

> **작성일**: 2026-11-20  
> **상태**: 확정 (클로드 코드가 바로 구현 가능한 상세 명세 및 단계별 계획)  
> **목적**: 증권사(KIS)·거래소(KRX/코스콤) 시세 재배포 라이선스 문제를 **100% 원천 해소**하기 위해, 서버가 자체 생성한 **완전 합성 가상 일봉(종가) 데이터(방식 A)** 기반의 **매일 1회 의사결정 연속 시즌형 교육용 종가 게임(유형 1)**을 별도 화면으로 구축한다.  
> **핵심 원칙 (Zero Deletion & Regression 방지)**: 기존의 실시간 트레이딩 게임(`GamePage.tsx`, `mobile/src/app/(tabs)/game.tsx`, 백엔드 실시간 WebSocket·KIS 연동 및 테이블)은 **향후 유료 플랜 또는 시세 라이선스 취득 시 즉시 재사용할 수 있도록 단 한 줄도 삭제하거나 훼손하지 않고 100% 보존**하며, 신규 교육용 종가 게임은 독립된 컴포넌트·라우터·테이블로 분리 구현한다.

---

## 1. 기획 배경 및 핵심 컨셉

### 1.1 왜 합성 종가 게임인가?
1. **시세 재배포 라이선스 리스크 0%**:
   * KRX/코스콤 및 증권사 Open API 시세는 비상업·종가 여부와 무관하게 제3자(일반 사용자) 화면에 그대로 노출할 경우 시세 재배포 계약이 필요합니다([`docs/deploy/market-data-licensing.md`](deploy/market-data-licensing.md)).
   * 반면 서버가 수학적 확률 모델과 기술적 패턴 알고리즘으로 자체 생성한 **합성 가상 시세(Synthetic OHLCV)**는 외부 저작권이나 거래소 라이선스 제약이 전혀 없는 **순수 자체 창작 교육 콘텐츠**입니다.
2. **차트 교육 효과 극대화 (종가 기반 하루 1회 의사결정)**:
   * 초단타 호가창 도박이 아니라, 일봉 차트의 **이동평균선(5·20·60일선), 볼린저 밴드, 매물대(Volume Profile & POC), 지지·저항 수평 추세선**을 차분히 분석하고 **하루에 딱 1번** 포지션(상승 진입 / 하락 진입 / 관망·청산)과 손절·익절 라인을 세우는 정석 스윙 트레이딩 훈련을 제공합니다.
3. **기존 실시간 게임 완벽 보존 (듀얼 모드 아키텍처)**:
   * 기존 실시간 게임(`REAL_MARKET`)은 그대로 보존합니다.
   * 기본 상태(`REAL_MARKET=OFF`, `EDU_DAILY_GAME=ON`)에서는 모든 일반 사용자에게 **신규 교육용 종가 게임 화면**이 기본 게임 탭으로 열리며, 향후 유료 회원이나 시세 라이선스 도입 시 관리자 스위치로 기존 실시간 게임을 함께 또는 전환하여 제공할 수 있습니다.

---

## 2. 게임 규칙 및 진행 프로세스 (방식 A + 유형 1)

### 2.1 데이터 생성 방식 (방식 A: 완전 합성 가상 테마/종목 일봉 생성기)
* **가상 종목/테마 그룹 명칭**:
  * 실제 상장사 종목코드나 종목명을 일절 사용하지 않습니다.
  * 시즌마다 서버가 가상 교육 지수/종목 코드를 부여합니다.
    * 예시 티커: `SYN-01`, `SYN-02`, `SYN-03` ...
    * 예시 표시명: `[교육 차트 #1] AI·반도체 모멘텀 가상지수`, `[교육 차트 #2] 친환경·에너지 추세 가상지수`, `[교육 차트 #3] 바이오·헬스케어 변동성 가상종목` (또는 관리자 설정에 따라 종목명 없이 `교육용 가상 차트 #N`으로 표기 가능)
* **초기 워밍업 캔들 (시즌 시작 시 120봉 자동 생성)**:
  * 시즌이 시작될 때 이평선(5·20·60일), 볼린저밴드(20일), 매물대(POC), 지지·저항선이 즉시 그려질 수 있도록 **과거 120일치 가상 일봉(OHLCV)**을 시드(Seed) 기반으로 즉시 생성합니다.
  * 시작 기준 가격은 `50,000원`(또는 `100,000원`) 정수로 설정하고 호가 단위(100원 단위)로 반올림하여 실제 한국 주식 차트와 동일한 눈금 감각을 제공합니다.
* **일일 1캔들 진행 알고리즘 (Regime-Switching + 기술적 패턴 합성 엔진)**:
  * 단순 완전 무작위(Random Walk)는 차트 분석 교육이 불가능하므로, **4가지 시장 국면(Regime) 상태 머신**으로 현실적인 추세와 패턴을 만듭니다:
    1. `ACCUMULATION` (매집·박스권 횡보: 변동성 축소, 볼린저밴드 수축, 지지·저항 형성)
    2. `UPTREND` (상승 추세: 5일·20일 정배열 유지, 거래량 동반 돌파 및 눌림목 지지)
    3. `DISTRIBUTION` (고점 과열·분산: 윗꼬리 대량 거래량, RSI 과매수, 저항선 테스트)
    4. `DOWNTREND` (하락 추세·조정: 지지선 이탈, 역배열, 과매도 반등 시그널)
  * 각 국면은 5~15캔들 주기로 자연스럽게 전이되며, 관리자가 다음 날 국면 힌트(또는 강제 추세 방향)를 지정할 수도 있고 서버가 결정론적 시드(`HMAC-SHA256(SECRET_KEY, season_id + day_index)`)로 자동 진행할 수도 있습니다.

### 2.2 하루 1회 참가 및 일일 정산 사이클 (유형 1: 일일 연속 시즌형)
* **시즌 주기 및 초기 자본금**:
  * 월간 시즌(매월 1일 ~ 말일, 약 20~30일) 또는 관리자 지정 시즌.
  * 시작 가상 자본금: **10,000,000원 (1,000만 원)**.
* **하루 1회 의사결정 (Daily Action Ticket)**:
  * 사용자는 **하루(KST 기준 1일 1회차)에 딱 1번** 오늘의 의사결정을 제출할 수 있습니다.
  * **보유 포지션이 없을 때 선택 가능한 행동**:
    1. **📈 상승 진입 (LONG)**: 비중(`25% / 50% / 100%`), 배율(`1x / 2x`, 아카데미 수료 시 `5x`), 손절폭(`-3% / -5% / -7%`), 익절폭(`+5% / +10% / +15%`) 설정 후 오늘 종가(`close`)로 진입 예약.
    2. **📉 하락 진입 (SHORT)**: 동일 옵션으로 오늘 종가 기준 하락 진입 예약.
    3. **👀 오늘 관망 (HOLD / PASS)**: 포지션 없이 오늘 하루를 관망(관망 제출 시에도 **오늘의 게임 참가 완료로 인정되어 연속 출석 Streak +1 및 관망 학습 보너스 지급**).
  * **보유 포지션이 있을 때 선택 가능한 행동 (하루 1회)**:
    1. **🔒 포지션 유지 & 손절/익절 재설정 (KEEP / ADJUST)**: 현재 포지션을 유지하거나 손절·익절 라인을 조정.
    2. **💰 절반 익절 / 원금 회수 (PARTIAL CLOSE 50%)**: 현재 종가 기준으로 50% 물량만 확정 청산하고 나머지 50% 유지.
    3. **🚪 전량 청산 (FULL CLOSE)**: 오늘 종가 기준으로 포지션 전량 청산.
* **일일 새 캔들 생성 및 자동 정산 (매일 KST 20:00 또는 자정 배치 + 관리자 즉시 진행 버튼)**:
  * 매일 정해진 정산 시각(기본 **매일 20:00 KST**, 관리자 설정 가능)에 Celery 태스크가 실행되어:
    1. **새 일봉 캔들 1개(Open, High, Low, Close, Volume) 생성**
    2. **보유 포지션 일괄 평가 및 자동 청산 판정**:
       * 새로 생성된 일봉의 장중 고가(`high`) / 저가(`low`)가 사용자의 손절가(`stop_loss_price`) 또는 익절가(`take_profit_price`)에 도달했는지 검사.
       * 손절/익절 동시 도달 시 보수적 기준(시가 `open`에서 더 가까운 가격 우선)으로 체결 처리.
       * 미도달 시 새 일봉의 종가(`close`) 기준으로 미실현 손익(`unrealized_pnl`), 총자산(`total_asset`), 수익률(`current_roi`) 갱신.
    3. **오늘의 AI/코치 차트 복기 해설 자동 생성**:
       * 새 캔들이 왜 그런 모양(예: *"20일선 지지 후 거래량 동반 양봉 돌파"*, *"POC 매물대 저항에 부딪힌 윗꼬리 음봉"*)이 나왔는지 교육용 1~2줄 해설과 지지·저항선 좌표를 자동 산출.
    4. **일일·주간·시즌 랭킹 및 참여자 심리(Long vs Short vs 관망 비율) 집계**.

---

## 3. 화면 분리 및 라우팅 아키텍처 (Zero Deletion)

### 3.1 기존 실시간 게임과 신규 교육용 종가 게임의 공존 구조
기존 파일은 절대 삭제하거나 덮어쓰지 않고, 아래와 같이 **별도 컴포넌트와 라우트**로 분리합니다.

| 구분 | 기존 실시간 게임 (보존 - 향후 유료/라이선스용) | 신규 교육용 합성 종가 게임 (기본 공개) |
| :--- | :--- | :--- |
| **관리자 플래그** | `REAL_MARKET` (기본 `OFF`) | `EDU_DAILY_GAME` (기본 `ON`) |
| **백엔드 라우터** | `/api/game/*` + `/ws/game/stream` (기존 코드 100% 유지) | `/api/game/edu/*` (`backend/apps/trading_game/routers/edu_game.py` 신설) |
| **웹 페이지** | `web_client/src/pages/GamePage.tsx` (기존 유지) | `web_client/src/pages/EduDailyGamePage.tsx` (신설, `/edu-game` 및 `/game` 게이트 연결) |
| **모바일 화면** | `mobile/src/app/(tabs)/game.tsx` 내 `GameScreen` (기존 유지) | `mobile/src/features/edu-game/edu-daily-game-screen.tsx` (신설) |
| **차트 표시** | KIS 실시간 틱 + 분봉/일봉 (`TradingChart` / `DailyChart`) | 합성 일봉 + 이평선(5·20·60) + POC 매물대 + 지지/저항 수평추세선 |

### 3.2 게임 탭(`/game`) 진입 시 스마트 분기 규칙
1. **`REAL_MARKET=OFF` 이고 `EDU_DAILY_GAME=ON` 일 때 (현재 기본 출시 상태)**:
   * 하단 네비게이션의 `[게임]` 탭을 모든 사용자에게 **항상 노출**합니다.
   * `[게임]` 탭(`/game`) 진입 시 기존의 "지금은 게임을 이용할 수 없어요" 빈 화면 대신 **`EduDailyGameScreen` (교육용 종가 게임 화면)**을 바로 렌더링합니다.
   * 웹에서도 `/edu-game` 전용 경로와 `/game` 기본 진입 모두에서 교육용 종가 게임을 이용할 수 있습니다.
2. **`REAL_MARKET=ON` (또는 관리자/시세 열람 권한 회원) 이고 `EDU_DAILY_GAME=ON` 일 때 (향후 유료/라이선스 오픈 시)**:
   * 게임 화면 상단에 **[📘 일일 종가 게임 (교육용)] | [⚡ 실시간 게임 (PRO)]** 모드 전환 탭(Segmented Control)이 나타나 두 게임을 모두 오가며 플레이할 수 있습니다!

---

## 4. 백엔드 데이터베이스 및 API 상세 설계

### 4.1 신규 PostgreSQL 테이블 (`backend/shared/game_models.py` 추가)
기존 `game_seasons`, `game_accounts` 테이블을 건드리지 않고, 교육용 종가 게임 전용 테이블 4개를 추가합니다 (Alembic 마이그레이션 1개).

#### 1) `edu_game_seasons` (교육용 합성 종가 시즌)
```sql
CREATE TABLE edu_game_seasons (
    id SERIAL PRIMARY KEY,
    season_number INTEGER NOT NULL UNIQUE,
    synthetic_code VARCHAR(20) NOT NULL,         -- 예: 'SYN-202611'
    title VARCHAR(100) NOT NULL,                 -- 예: '[교육 지수] AI·반도체 모멘텀 그룹'
    theme_category VARCHAR(50) NOT NULL,         -- 예: 'IT/반도체', '친환경/2차전지', '무명 차트(블라인드)'
    hide_name BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE 이면 화면에 종목/테마명 없이 '교육용 차트 #N'만 표시
    seed_key VARCHAR(64) NOT NULL,               -- 결정론적 캔들 생성 시드
    current_day_index INTEGER NOT NULL DEFAULT 120, -- 현재까지 공개된 캔들 번호 (초기 워밍업 120봉)
    current_regime VARCHAR(30) NOT NULL DEFAULT 'ACCUMULATION', -- ACCUMULATION | UPTREND | DISTRIBUTION | DOWNTREND
    regime_days_left INTEGER NOT NULL DEFAULT 8,
    next_regime_override VARCHAR(30) NULL,       -- 관리자가 다음 국면을 수동 지정할 때 사용
    initial_cash NUMERIC(15, 2) NOT NULL DEFAULT 10000000,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- READY | ACTIVE | CLOSED
    last_advanced_date DATE NULL,                -- 마지막 일일 정산 실행일 (KST)
    start_date DATE NOT NULL,
    end_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 2) `edu_game_candles` (합성 일봉 OHLCV 및 일별 교육 해설)
```sql
CREATE TABLE edu_game_candles (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL REFERENCES edu_game_seasons(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL,                  -- 1 ~ 120 (초기), 121, 122 ... (매일 1씩 증가)
    display_date DATE NOT NULL,                  -- 차트 X축 표시용 가상/기준 날짜
    open NUMERIC(12, 2) NOT NULL,
    high NUMERIC(12, 2) NOT NULL,
    low NUMERIC(12, 2) NOT NULL,
    close NUMERIC(12, 2) NOT NULL,
    volume BIGINT NOT NULL,
    change_pct NUMERIC(8, 4) NOT NULL DEFAULT 0,
    regime VARCHAR(30) NOT NULL,                 -- 해당 봉이 생성된 시장 국면
    pattern_tag VARCHAR(50) NULL,                -- 예: '20일선 돌파', '볼린저 하단 지지', 'POC 매물대 돌파'
    coach_comment TEXT NULL,                     -- 오늘의 차트 교육 해설 (1~2문장)
    support_price NUMERIC(12, 2) NULL,           -- 산출된 주요 지지선
    resistance_price NUMERIC(12, 2) NULL,        -- 산출된 주요 저항선
    poc_price NUMERIC(12, 2) NULL,               -- 최근 60봉 기준 최대 매물대(POC) 가격
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edu_season_day UNIQUE (season_id, day_index)
);
CREATE INDEX idx_edu_candles_season_day ON edu_game_candles (season_id, day_index);
```

#### 3) `edu_game_accounts` (유저별 교육용 게임 계좌 및 활성 포지션)
```sql
CREATE TABLE edu_game_accounts (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES edu_game_seasons(id) ON DELETE CASCADE,
    cash_balance NUMERIC(15, 2) NOT NULL DEFAULT 10000000,
    bonus_cash NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_asset NUMERIC(15, 2) NOT NULL DEFAULT 10000000,
    current_roi NUMERIC(8, 4) NOT NULL DEFAULT 0,
    max_roi NUMERIC(8, 4) NOT NULL DEFAULT 0,
    total_trades INTEGER NOT NULL DEFAULT 0,
    win_trades INTEGER NOT NULL DEFAULT 0,
    participation_days INTEGER NOT NULL DEFAULT 0, -- 이번 시즌 일일 의사결정 참여 일수
    last_action_day_index INTEGER NULL,            -- 마지막으로 하루 1회 참가를 마친 day_index (중복 참가 방지!)
    last_action_date DATE NULL,                    -- 마지막 참가 KST 날짜
    -- 현재 보유 포지션 (단일 포지션 구조로 조회·정산 단순화)
    pos_side VARCHAR(10) NULL,                     -- NULL(포지션 없음) | 'LONG' | 'SHORT'
    pos_entry_price NUMERIC(12, 2) NULL,
    pos_size_amount NUMERIC(15, 2) NULL,
    pos_leverage INTEGER NOT NULL DEFAULT 1,
    pos_stop_loss NUMERIC(12, 2) NULL,
    pos_take_profit NUMERIC(12, 2) NULL,
    pos_opened_day_index INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edu_user_season UNIQUE (user_id, season_id)
);
```

#### 4) `edu_game_daily_actions` (하루 1회 참가 기록 및 정산 내역)
```sql
CREATE TABLE edu_game_daily_actions (
    id SERIAL PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES edu_game_accounts(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES edu_game_seasons(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_index INTEGER NOT NULL,                    -- 참가 시점의 캔들 번호
    action_date DATE NOT NULL,                     -- 참가 KST 날짜 (하루 1회 제약용)
    action_type VARCHAR(20) NOT NULL,              -- 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD_WATCH' | 'KEEP_POS' | 'PARTIAL_CLOSE' | 'FULL_CLOSE'
    ratio NUMERIC(5, 4) NULL,                      -- 진입 비중 (0.25, 0.5, 1.0)
    leverage INTEGER NOT NULL DEFAULT 1,
    stop_loss_price NUMERIC(12, 2) NULL,
    take_profit_price NUMERIC(12, 2) NULL,
    execution_price NUMERIC(12, 2) NOT NULL,       -- 해당 day_index 종가
    realized_pnl NUMERIC(15, 2) NULL,              -- 청산 또는 다음 날 정산 시 확정된 손익
    settlement_note VARCHAR(200) NULL,             -- 다음 날 정산 결과 요약 (예: '익절가 54,200원 도달 (+8.4%)')
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_edu_account_day_index UNIQUE (account_id, day_index)
);
```

---

### 4.2 합성 캔들 & 테마 그룹 생성 엔진 (`backend/apps/trading_game/services/edu_synthetic_engine.py`)
1. **호가 단위 정규화 (`round_tick`)**:
   * 생성된 모든 시가·고가·저가·종가는 한국 거래소 호가 단위(1만 원~5만 원 미만 50원, 5만 원~20만 원 미만 100원)로 반올림합니다.
2. **국면(Regime)별 일일 수익률·변동성 파라미터**:
   * `ACCUMULATION` (박스권 매집): 평균 일간 등락 `0.0%`, 표준편차 `1.1%`, 거래량 배수 `0.6~0.9x`
   * `UPTREND` (상승 추세): 평균 일간 등락 `+0.85%`, 표준편차 `1.8%`, 거래량 배수 `1.1~2.2x` (돌파 봉에서 거래량 급증 발생)
   * `DISTRIBUTION` (고점 과열): 평균 일간 등락 `+0.1%`, 표준편차 `2.4%`, 윗꼬리 비율 확대, 거래량 배수 `1.5~2.8x`
   * `DOWNTREND` (하락 조정): 평균 일간 등락 `-0.75%`, 표준편차 `1.9%`, 거래량 배수 `0.9~1.6x`
3. **지지·저항·POC 자동 계산**:
   * 최근 60봉의 가격대별 거래량 프로파일(24개 구간)을 계산해 최대 거래량 구간 중심가를 `poc_price`로 기록합니다.
   * 최근 20~60봉의 스윙 저점 클러스터를 `support_price`, 스윙 고점 클러스터를 `resistance_price`로 자동 산출합니다.
4. **교육용 코치 해설 자동 생성 (`build_edu_comment`)**:
   * 이동평균선(MA5, MA20, MA60) 정배열 여부, POC 대비 현재 종가 위치, 지지·저항 돌파/반등 여부를 판별하여 `"20일 이동평균선과 POC 매물대(51,200원) 위에서 거래량이 실린 양봉이 출현했습니다. 단기 지지선 유지 여부를 확인하세요."` 형태의 교육 코멘트를 자동 생성합니다.

---

### 4.3 REST API 엔드포인트 명세 (`backend/apps/trading_game/routers/edu_game.py`)

Prefix: `/api/game/edu`

| 메서드 & 경로 | 인증 | 설명 |
| :--- | :--- | :--- |
| `GET /api/game/edu/state` | 선택 (비로그인도 차트·시즌 조회 가능) | 현재 활성 교육 시즌 정보, 최근 120봉 일봉 배열(`candles`), 오늘의 코치 교육 해설, 지지/저항/POC 가격, 참여자 오늘의 선택 비율(상승/하락/관망 %), (로그인 시) 내 계좌·포지션·**오늘 참가 완료 여부(`today_submitted: bool`)** 반환 |
| `POST /api/game/edu/action` | 필수 (`get_current_user`) | **하루 1회 의사결정 제출**. 이미 현재 `day_index`(또는 오늘 KST 날짜)에 제출했으면 `409 Conflict` (`ALREADY_PARTICIPATED_TODAY`, `"오늘은 이미 게임에 참가했어요. 내일 새 종가 캔들이 열리면 다시 참가할 수 있어요!"`) 반환. 제출 시 연속 출석(`streak_service.touch`) 자동 갱신 |
| `GET /api/game/edu/leaderboard` | 공개 | 현재 교육 시즌 수익률(`current_roi`) Top 50 랭킹 및 내 순위 반환 |
| `GET /api/game/edu/history` | 필수 | 이번 시즌 나의 일별 참가 내역(`edu_game_daily_actions`) 및 정산 손익 히스토리 반환 |
| `POST /api/game/admin/edu/advance-day` | 관리자 (`require_admin`) | **(관리자 테스트·운영용)** 즉시 다음 날 일봉 1캔들을 생성하고 전 유저 포지션 일일 정산을 1회 실행 |
| `POST /api/game/admin/edu/new-season` | 관리자 (`require_admin`) | 새 교육용 가상 테마/종목 시즌 생성 (가상 테마명, 블라인드 여부 `hide_name`, 초기 120봉 즉시 생성) |
| `PUT /api/game/admin/edu/regime` | 관리자 (`require_admin`) | 다음 캔들 생성 시 적용할 시장 국면(`ACCUMULATION` / `UPTREND` / `DISTRIBUTION` / `DOWNTREND`) 지정 |

---

## 5. 프론트엔드 (Web & Mobile) 별도 화면 설계

### 5.1 상단 헤더 & 오늘의 참가 상태 배지
* **종목/테마 헤더**:
  * `[교육용 종가 게임]` 배지 + 가상 테마 그룹명(예: `AI·반도체 모멘텀 가상지수` 또는 `hide_name=true`일 때 `블라인드 교육 차트 #1`) + 현재 기준 종가 및 전일 대비 등락률 표시.
  * 우측에 **[오늘 참가 가능 🟢]** 또는 **[오늘 참가 완료 ✅ (내일 20:00 정산)]** 상태 칩 표시.
* **데이터 면책 & 안내 문구**:
  * 차트 상단/하단에 `"본 차트는 투자 교육을 위해 서버가 자체 생성한 가상 일봉 데이터이며 실제 상장 종목과 무관합니다."` 안내 표시 (스토어 심사 및 라이선스 완벽 방어).

### 5.2 교육용 일봉 차트 영역 (POC 매물대 + 지지·저항 수평추세선 연동)
* 앞서 명세한 [`docs/game_lightweight_sr_action_spec_and_plan.md`](game_lightweight_sr_action_spec_and_plan.md)의 차트 시인성 개선 사항을 그대로 적용합니다:
  1. **캔들 + 이동평균선(5·20·60일) + 볼린저밴드 토글**.
  2. **매물대(Volume Profile) & POC 강조**: 최대 매물대(POC) 바는 골드/앰버 하이라이트 + `[POC]` 가로 기준선 표시.
  3. **지지·저항 긴 수평추세선**: 구분 색상 없이 단일 중립 색상(`#94A3B8`)의 차트 전체 폭 수평선으로 표시, 관리자 `SR_DEFAULT`(테스트용 기본 `ON`) 및 유저 `[지지·저항]` 토글 칩 제공.

### 5.3 하루 1회 의사결정 패널 (`EduDailyActionPanel`)
* **아직 오늘 참가하지 않았을 때 (`today_submitted === false`)**:
  * **포지션 미보유 시**:
    * 3개 탭/버튼: **[📈 상승 진입]** / **[📉 하락 진입]** / **[👀 오늘 관망]**
    * 진입 선택 시: 비중(`25% / 50% / 100%`), 배율(`1x / 2x / 5x`), 손절(`-3% / -5% / -7%`), 익절(`+5% / +10% / +15%`) 선택 후 **[오늘의 결정 제출하기 (1일 1회)]** 버튼 클릭.
    * 관망 선택 시: **[오늘 하루 관망하기 (출석 인정)]** 클릭 → 리스크가 높은 구간에서 쉬어가는 것도 중요한 투자 기술임을 칭찬하는 토스트 노출.
  * **포지션 보유 중일 때**:
    * 현재 진입가, 평가손익, 설정된 손절/익절가 표시.
    * 3개 행동 버튼: **[🔒 포지션 유지 (손절/익절 수정)]** / **[💰 50% 부분 청산]** / **[🚪 전량 청산]**
* **오늘 이미 참가를 완료했을 때 (`today_submitted === true`)**:
  * 주문 버튼이 잠기며 **"오늘의 트레이딩 결정을 완료했어요!"** 카드 표시:
    * 내가 오늘 제출한 결정(예: `상승 진입 · 비중 50% · 손절 -5% / 익절 +10%`) 요약.
    * `"다음 종가 캔들 생성 및 손익 정산까지 남은 시간"` 안내.
    * 다른 참가자들의 오늘 선택 비율 바(`상승 N% · 하락 M% · 관망 K%`) 공개.

---

## 6. 클로드코드(Claude Code) 단계별 구현 계획

클로드 코드에서 작업할 때 아래 6단계를 순서대로 진행합니다.

### Step 1: 기능 플래그 확장 및 DB 모델·마이그레이션 추가
* **수정 파일**:
  * `backend/apps/trading_game/services/feature_flag_service.py`
    * `KNOWN_FLAGS`에 `"EDU_DAILY_GAME"` 추가, `DEFAULTS["EDU_DAILY_GAME"] = True` 설정 (기본 켜짐).
  * `backend/shared/game_models.py`
    * `EduGameSeason`, `EduGameCandle`, `EduGameAccount`, `EduGameDailyAction` 4개 ORM 클래스 추가 (기존 모델 수정 없음).
  * `backend/alembic/versions/`
    * 신규 마이그레이션 파일 생성 (`edu_game_*` 4개 테이블 생성).

### Step 2: 합성 일봉 생성 엔진 및 일일 정산 서비스 구현
* **신규 파일**:
  * `backend/apps/trading_game/services/edu_synthetic_engine.py`
    * 결정론적 시드 기반 초기 120봉 생성기(`generate_initial_candles`) 및 일일 1봉 추가 생성기(`generate_next_candle`).
    * 국면 상태 전이(`ACCUMULATION` → `UPTREND` → `DISTRIBUTION` → `DOWNTREND`), 호가 단위 반올림, POC·지지·저항·코치 해설 산출 순수 함수 구현.
  * `backend/apps/trading_game/services/edu_game_service.py`
    * 활성 시즌 자동 부트스트랩(시즌이 없으면 시즌 1기 `[교육 지수] AI·반도체 모멘텀 가상그룹` + 초기 120봉 자동 시드).
    * `get_edu_state(db, user_id)`: 차트 120봉, 코치 해설, 내 계좌, `today_submitted` 판정, 참여자 심리 집계.
    * `submit_daily_action(db, redis, user, payload)`: **하루 1회 참가 검증(`last_action_day_index == season.current_day_index` 또는 `last_action_date == today_kst` 이면 `409` 차단)**, 포지션 진입/관망/부분청산/전량청산 처리, `streak_service.touch` 연동.
    * `advance_day_and_settle(db)`: 새 일봉 1개 생성 + 열린 포지션의 고가/저가 기준 손절·익절 자동 체결 및 종가 평가손익 갱신.

### Step 3: 백엔드 라우터 및 Celery 일일 정산 스케줄 연결
* **신규/수정 파일**:
  * `backend/apps/trading_game/routers/edu_game.py` (신규):
    * `/api/game/edu/state`, `/api/game/edu/action`, `/api/game/edu/leaderboard`, `/api/game/edu/history` 및 관리자용 `/api/game/admin/edu/*` 엔드포인트 구현.
  * `backend/apps/trading_game/main.py`:
    * 기존 라우터들은 그대로 두고 `app.include_router(edu_game.router)` 추가.
  * `backend/apps/trading_game/schemas/game_dtos.py`:
    * `SeasonFeaturesDTO`에 `edu_daily_game: bool = True` 필드 추가 (기존 `real_market`, `quiz`, `streak`, `sr_default` 유지).
  * `backend/apps/collector/celery_app.py` (또는 게임 정산 태스크):
    * 평일 20:00 KST에 `edu_game_service.advance_day_and_settle`이 자동 실행되도록 스케줄 등록.

### Step 4: 관리자 웹(`admin_web`) 교육용 종가 게임 제어 패널 추가
* **수정 파일**:
  * `admin_web/src/types/game.ts`, `admin_web/src/pages/TradingGameSettings.tsx`
    * `FLAG_META`에 `EDU_DAILY_GAME` (`📘 교육용 일일 종가 게임 공개`) 토글 추가.
    * 하단에 **[교육용 종가 게임 운영]** 카드 추가:
      * 현재 시즌 정보(시즌 번호, 가상 테마명, 현재 캔들 `Day N`, 현재 시장 국면) 표시.
      * **[+1일 다음 종가 캔들 즉시 생성 & 정산 (테스트용)]** 버튼 (`POST /api/game/admin/edu/advance-day`).
      * 다음 국면 선택 드롭다운(`매집 횡보` / `상승 추세` / `고점 분산` / `하락 조정`) 및 새 시즌 생성(테마명 지정 / 종목명 숨김 블라인드 체크박스) 제공.

### Step 5: 웹 클라이언트(`web_client`) 별도 화면 구현 및 게임 탭 연결
* **신규 파일**:
  * `web_client/src/api/eduGame.ts` & `web_client/src/types/eduGame.ts`
  * `web_client/src/pages/EduDailyGamePage.tsx` (신규 교육용 종가 게임 전용 화면)
  * `web_client/src/components/edu-game/EduDailyActionPanel.tsx` (하루 1회 진입/관망/청산 의사결정 패널)
* **수정 파일 (기존 `GamePage.tsx`의 `GameScreen` 보존)**:
  * `web_client/src/pages/GamePage.tsx`:
    * 기존 `GameScreen`(실시간 게임) 코드는 **단 한 줄도 삭제하지 않고 그대로 유지**합니다.
    * `GamePage` 진입부에서:
      * `real_market === true` 이고 `edu_daily_game === true` 이면 상단에 `[📘 일일 종가 게임] | [⚡ 실시간 게임]` 전환 탭을 제공.
      * `real_market === false` 이고 `edu_daily_game === true` (기본 상태)이면 `EduDailyGamePage`를 렌더링.
  * `web_client/src/lib/marketAccess.ts` & `web_client/src/hooks/useGameAccess.ts`:
    * 네비게이션의 `[게임]` 탭 노출 판정을 `real_market || edu_daily_game`으로 확장하여 일반 사용자에게도 `[게임]` 탭이 정상 노출되도록 변경.

### Step 6: 모바일 앱(`mobile`) 별도 화면 구현 및 게임 탭 연결
* **신규 파일**:
  * `mobile/src/features/edu-game/api.ts`, `mobile/src/features/edu-game/types.ts`
  * `mobile/src/features/edu-game/edu-daily-game-screen.tsx` (모바일 교육용 종가 게임 전용 화면)
  * `mobile/src/features/edu-game/components/edu-action-panel.tsx`
* **수정 파일 (기존 `mobile/src/app/(tabs)/game.tsx`의 `GameScreen` 보존)**:
  * `mobile/src/app/(tabs)/game.tsx`:
    * 기존 `GameScreen`(실시간 게임) 코드는 **그대로 보존**합니다.
    * `GameTab`에서 `realMarket`이 꺼져 있어도 `eduDailyGame`이 켜져 있으면 `EduDailyGameScreen`을 렌더링하고, 둘 다 켜져 있으면 상단 세그먼트 버튼으로 두 화면을 전환할 수 있게 연결합니다.
  * `mobile/src/features/market-access/access.ts` & `use-game-access.ts`:
    * 하단 `[게임]` 탭이 `real_market || edu_daily_game`일 때 항상 표시되도록 업데이트합니다.

---

## 7. 테스트 및 검증 체크리스트

- [ ] **백엔드 유닛 테스트 (`backend/tests/test_edu_daily_game.py`)**:
  - [ ] 초기 120봉 합성 캔들 생성 시 `low <= open, close <= high`, 호가 단위 정규화, `poc_price`·`support_price`·`resistance_price` 정상 산출 검증.
  - [ ] **하루 1회 참가 제한 검증**: 같은 `day_index`(또는 같은 KST 날짜)에 두 번째 `POST /api/game/edu/action` 호출 시 `409 ALREADY_PARTICIPATED_TODAY` 반환 검증.
  - [ ] `+1일 정산(advance_day_and_settle)` 실행 후 `current_day_index`가 `+1` 증가하면 다시 하루 1회 참가가 가능해지는지 검증.
  - [ ] 포지션 보유 중 새 캔들의 `low <= stop_loss_price`일 때 자동 손절 체결, `high >= take_profit_price`일 때 자동 익절 체결 검증.
  - [ ] 관망(`HOLD_WATCH`) 제출 시에도 오늘의 참가 완료 처리 및 연속 출석(`UserStreak`)이 갱신되는지 검증.
- [ ] **회귀 방지 검증 (Zero Deletion)**:
  - [ ] 기존 실시간 게임 테스트(`backend/tests/test_trading_game_*.py`, `web_client`, `mobile` 기존 테스트)가 단 하나도 깨지지 않고 100% 통과하는지 확인.
  - [ ] 관리자 웹에서 `REAL_MARKET`을 켰을 때 기존 실시간 게임 화면(`GameScreen`)으로 즉시 전환 가능한지 확인.

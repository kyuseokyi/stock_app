[명령어: 이 작업은 `backend/` 및 `admin_web/` 디렉토리에서 수행하세요. 사전에 `docs/prompts/00_master_prompt.md`, `CLAUDE.md`, `docs/trading_game_plan.md`의 규칙을 숙지했다고 가정합니다.]

당신의 임무는 관리자가 시황 및 지지/저항선을 입력하는 **어드민 웹(`admin_web`) 스마트 코치 발행 UI**, **실시간 스마트 넛지(Nudge) 룰 엔진**, **단계별 퀘스트/Streak**, 그리고 **야간 10초 차트 패턴 퀴즈 API**를 구축하는 것입니다.

---

## 1. 세부 구성 및 스펙

### 1) 관리자 스마트 코치 관리 API & Admin Web UI
- **백엔드 API (`backend/apps/trading_game/routers/coach.py`)**:
  - `POST /api/game/admin/coach-messages`: 관리자 코칭 메시지 발행 (권한: `ADMIN`)
    - 입력: `season_id`, `target_date`, `coach_type` ('MORNING' | 'EVENING'), `title`, `summary_nudge` (1줄 롤링 멘트), `support_price` (지지선), `resistance_price` (저항선), `content_md` (마크다운 본문)
  - `GET /api/game/coach/today`: 유저 차트 상단에 노출할 오늘의 활성 코칭 및 지지/저항선 데이터 반환
- **Admin Web 프론트엔드 (`admin_web/src/pages/TradingGameCoach.tsx`)**:
  - 기존 `admin_web`의 레이아웃과 디자인 시스템(TailwindCSS)을 준수
  - 라우트 추가: `/game/coach` (사이드바에 '트레이딩 게임 > 데일리 코치' 메뉴 추가)
  - 시즌 선택 셀렉트박스, 모닝/이브닝 라디오 버튼, 날짜 피커
  - 지지선/저항선 숫자 인풋 (원 단위)
  - 1줄 요약 넛지 텍스트 인풋
  - 상세 시황 작성을 위한 마크다운 에디터 (기존 TipTap 또는 텍스트에디터 컴포넌트 재사용)
  - [임시저장], [🚀 실시간 발행하기] 버튼 구현

### 2) 인-게임 실시간 상황별 코칭 (Smart Nudge) 룰 엔진
- **엔진 위치**: `backend/apps/trading_game/services/nudge_engine.py`
- 주문 체결 또는 포지션 청산 시 백엔드 응답(또는 WebSocket)에 교육용 말풍선 멘트를 포함:
  - **과매수 추격 매수 경고**: 최근 14캔들 RSI $\ge 80$ 시점에 BUY 진입 $\rightarrow$ `type: WARNING`, *"⚠️ RSI 과열 구간입니다! 추격 매수는 물릴 위험이 높아요."*
  - **원칙 손절 칭찬**: 손실률 $-1\%$ ~ $-3\%$ 이내에서 손절 청산 시 $\rightarrow$ `type: PRAISE`, *"💡 원칙대로 손실을 잘 끊어냈습니다! 훌륭한 자금 관리 습관입니다."*
  - **과도한 레버리지/몰빵 경고**: 자본금 100% 비중 + 5배 레버리지 진입 시 $\rightarrow$ `type: ADVICE`, *"💬 과도한 레버리지는 급격한 마진콜을 유발할 수 있습니다. 분할 매수를 고려하세요."*

### 3) 단계별 트레이딩 퀘스트 & 아카데미 해금 시스템
- **API (`backend/apps/trading_game/routers/quests.py`)**:
  - `GET /api/game/quests`: 유저의 현재 퀘스트 달성 현황 조회
  - `POST /api/game/quests/{quest_id}/claim`: 보상 수령 (가상 시드머니 지급 및 계좌 반영)
- **주요 퀘스트 목록**:
  - Q1: 첫 Stop-Loss(손절선) 걸고 거래하기 (보상: +50만 원)
  - Q2: 이동평균선 골든크로스 시점에 매수하기 (보상: +100만 원)
  - Q3: 분할 매수 3회 실천하기 (보상: '원칙주의자' 뱃지)
- **아카데미 해금**:
  - 5배 레버리지 사용 권한은 '리스크 관리 미니 퀴즈'(3문항)를 통과한 유저에게만 `unlocked_leverage_5x=True` 플래그 부여.

### 4) 야간/주말 10초 차트 패턴 퀴즈 (Pattern Hunter) & Streak
- **API (`backend/apps/trading_game/routers/quiz.py`)**:
  - `GET /api/game/quiz/random`: `chart_quiz_pool`에서 아직 풀지 않은 문제 1개 반환 (정답/해설 제외, 가려진 캔들 데이터만 제공)
  - `POST /api/game/quiz/{id}/submit`: 유저 선택 (`UP` | `DOWN`) 제출
    - 채점 결과, 실제 주가 변동률, 기술적 분석 해설 마크다운 반환
    - 정답 시 가상 보상금(예: +20만 원) 계좌 지급
    - `user_streaks` 테이블의 `current_streak` +1 및 `last_activity_date` 갱신
  - `GET /api/game/streak/my`: 나의 연속 출석 일수 및 최고 기록 반환

---

## 2. 작업 순서 (Step by Step)

1. **백엔드 코치/퀘스트/퀴즈 라우터 및 서비스 구현**:
   - `backend/apps/trading_game/services/nudge_engine.py` 작성
   - `backend/apps/trading_game/services/quiz_service.py` 작성
   - `backend/apps/trading_game/routers/coach.py`, `quests.py`, `quiz.py` 작성 및 `main.py`에 등록
2. **어드민 웹 UI 개발 (`admin_web/`)**:
   - `admin_web/src/pages/TradingGameCoach.tsx` 페이지 작성
   - `admin_web/src/App.tsx` 또는 라우터에 경로 등록 및 네비게이션 메뉴 연결
   - API 클라이언트를 통해 발행 요청 연동
3. **검증 및 테스트**:
   - 백엔드: `uv run pytest tests/test_coach_and_quiz.py -v` (퀴즈 제출 및 넛지 멘트 검증)
   - 어드민 웹: `npm run build`로 빌드 에러 없는지 확인

# 트레이딩 게임 서브페이즈 6c — 모바일(Expo) 게임 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mobile/src/app/(tabs)/game.tsx`의 "시즌 준비 중" 스켈레톤을 web 6a+6b와 동등한 게임 화면(헤더·코치 배너·심리 바·일봉+실시간 차트·포지션 카드·주문 패널·토스트 + 랭킹/퀘스트/아카데미/야간 퀴즈 시트)으로 교체한다. **백엔드 변경 없음.**

**Architecture:** `features/game/` 아래 `types → lib(순수 함수, jest TDD) → api → store(zustand v5) + use-game-socket(RN WebSocket·AppState) → components → app/(tabs)/game.tsx` 단방향 레이어. 순수 로직은 web과 같은 시그니처·문구로 **복제**(공유 패키지 없음). 차트는 신규 네이티브 의존성 없이 `View` 절대 배치 + 순수 좌표 함수 `layoutCandles`. 모달은 RN `Modal`(slide·pageSheet) 래퍼 `Sheet`.

**Tech Stack:** Expo SDK 57 · RN 0.86 · React 19.2(React Compiler 켜짐) · TS strict · Unistyles v3 · zustand 5.0.15 · graphql-request 7 · jest-expo(순수 로직만)

**스펙:** `docs/superpowers/specs/2026-10-13-trading-game-phase6c-mobile-design.md` (기준: 6a/6b 스펙 + web 최종 구현 `web_client/src/{types/game.ts,api/game.ts,api/stock.ts,lib/*,store/tradingGame.ts,hooks/useGameWebSocket.ts,components/game/*,pages/GamePage.tsx}`)

---

## 공통 규칙 (모든 태스크)

- 브랜치 `dev`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml` 절대 스테이징 금지. `.git/index.lock` 이 있으면 잠시 후 재시도(다른 프로세스 커밋 중).
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- 모바일 검증(모든 태스크 공통 종료 조건):
  ```bash
  cd mobile
  npx tsc --noEmit
  npm test
  ```
- **신규 npm 의존성 금지**(차트·시트 모두 RN 기본 컴포넌트). `package.json`/lock 은 건드리지 않는다.
- TS 규칙: 명시적 `any`·`@ts-ignore` 금지. `as`는 외부 데이터 경계에서만, `!`는 근거 주석과 함께만(이 계획의 코드엔 둘 다 없음).
- 스타일: Unistyles v3 `StyleSheet.create((theme) => …)` + 테마 토큰(`theme.colors.*`·`theme.gap()`·`theme.radius.*`). 동적 수치(좌표·폭)는 `[styles.x, { left, width }]` 배열 병합. 날 색이 필요하면 `useUnistyles().theme`.
  - ⚠️ **Unistyles 스타일은 RN 기본 컴포넌트(View/Text/Pressable/ScrollView…)에만 넘긴다.** `react-native-safe-area-context`의 `SafeAreaView` 같은 서드파티 컴포넌트에 넘기면 web에서 배경색이 빠진다(계획 검증 중 실제 재현 — 시트 배경이 흰색으로 렌더). 안전영역은 `useSafeAreaInsets()` 패딩으로 처리.
- React Compiler 켜짐(`app.config.js experiments.reactCompiler`): 렌더 중 ref 대입 금지(effect 에서 갱신).
- `features/game/lib/*` 는 **순수 모듈만** import(`react-native` 금지). `@/lib/api`(index)는 graphql-request(ESM)를 끌어오므로 lib 에서는 `@/lib/api/http` 만 직접 import.
- 순수 로직은 TDD: 테스트 작성 → `npx jest <파일>` FAIL 확인 → 구현 → PASS.
- 기존 동작 보존: 수정하는 기존 파일은 `mobile/src/lib/env.ts`(필드 추가)·`mobile/src/app/(tabs)/game.tsx`(교체)·`mobile/.env.example`·README·ROADMAP 뿐. `@/ui`·`@/lib/api`·auth 는 수정하지 않는다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `mobile/src/lib/env.ts` (수정) | `ENV.gameApiUrl`(선택 — dev 미설정 시 `http://localhost:8003`, production 미설정 시 `undefined`) |
| `mobile/src/features/game/types.ts` | web `types/game.ts`(6a+6b)와 동일 계약 |
| `mobile/src/features/game/lib/decimal.ts` (+test) | Decimal 문자열 → number |
| `mobile/src/features/game/lib/format.ts` (+test) | 가격 콤마·KST 날짜·D-day·손익 톤(₩/%는 `@/ui` 재사용) |
| `mobile/src/features/game/lib/candles.ts` (+test) | 틱 → 오늘 캔들 병합(`mergeTick`) + 배열 반영(`applyTick`) |
| `mobile/src/features/game/lib/ws.ts` (+test) | WS 메시지 파서(`parseGameMessage`) |
| `mobile/src/features/game/lib/errors.ts` (+test) | `ApiError` → 사용자 문구(`gameErrorMessage`·`orderErrorMessage`·`apiErrorCode`) |
| `mobile/src/features/game/lib/quiz.ts` (+test) | 퀴즈 강조 시간·카운트다운 |
| `mobile/src/features/game/lib/chart-layout.ts` (+test) | 캔들/가격선 좌표 계산(`layoutCandles`·`priceRange`·`priceToY`) |
| `mobile/src/features/game/api.ts` | REST(`createHttpClient(ENV.gameApiUrl)`) + 일봉 GraphQL(`stockRequest`) + Dec→number |
| `mobile/src/features/game/store.ts` | zustand 게임 상태·액션·경쟁 가드(privateGen·refreshSeq) |
| `mobile/src/features/game/use-game-socket.ts` | RN WebSocket 재연결·4401·ping·AppState |
| `mobile/src/features/game/components/{game-header,coach-banner,sentiment-bar,position-card,order-panel,game-toaster,quiz-banner}.tsx` | 코어 화면 컴포넌트 |
| `mobile/src/features/game/components/candle-chart.tsx` | `CandleChart`(순수 View 렌더러) + `DailyChart`(일봉 로드·틱 병합·가격선) |
| `mobile/src/features/game/components/sheet.tsx` | 공용 RN Modal 시트(제목·닫기·안전영역·시트 내 토스트) |
| `mobile/src/features/game/components/{leaderboard,quest,academy,quiz}-sheet.tsx` | 6b 모달 4종 |
| `mobile/src/app/(tabs)/game.tsx` (교체) | 상태 분기 + 조립 + 당겨서 새로고침 |
| `mobile/.env.example` (수정), `README.md`, `docs/ROADMAP.md` | 문서 |

## 스펙 해석(모호점 확정)

1. **`.env.development` 는 gitignore 대상**(`.env.example` 만 커밋). 스펙 §6의 `.env.development` 추가는 **로컬 단계**로 수행하고, 커밋 대상은 `.env.example` 에 같은 줄을 추가한다(Task 10).
2. **토스트와 RN Modal**: 네이티브 Modal 은 별도 창이라 화면 오버레이 토스트가 시트에 가려진다(퀘스트 보상·아카데미 해금·퀴즈 503 토스트가 시트가 열린 채 발생). web 의 z-order 트릭 대신 **`Sheet` 안에 `GameToaster` 를 하나 더 렌더**하고, 화면 레벨 토스터는 `activeModal === null` 일 때만 렌더한다.
3. **시트 수명**: web 처럼 열 때 마운트·닫을 때 언마운트(`visible` 항상 true) — 열 때마다 로컬 state 초기화·새 로드, 타이머 정리 보장. 대가로 닫힘 슬라이드 애니메이션은 생략될 수 있다.
4. **WS + AppState**: `appActive` 를 연결 effect 의존성에 넣어 백그라운드 시 effect 정리로 소켓을 닫는다. effect 재실행은 `opened` 플래그를 초기화하므로 "재연결 시 재조회"가 자동으로 일어나지 않는다 → **비활성→active 전환 시 `refreshTrading()` 을 명시 호출**.
5. **비로그인 진입**: 주문/퀘스트/퀴즈/아카데미 → 토스트 `내정보 탭에서 로그인하고 시즌에 참여하세요` + `router.push('/(tabs)/profile')`(typed routes 에 존재). 로그인 후 원래 시트는 자동으로 열리지 않는다(web 과 동일).
6. **`formatPct` 반올림 차이**: 스펙대로 `@/ui` 의 `formatPct` 재사용. web 은 `-0.04 → '0.0%'`, 모바일 `@/ui` 는 `'-0.0%'`(값이 정확히 0 일 때만 부호 없음). `@/ui` 는 회귀 방지를 위해 수정하지 않는다(위험 항목).
7. **`formatPrice`**: Hermes/Android Intl 로케일 차이를 피하려고 `@/ui` 와 같이 `toLocaleString('en-US')`(원 단위 반올림). 가격은 정수라 web 과 표시 동일.
8. **차트**: 일봉 최근 60개, 높이 240(퀴즈 200, 가격 라벨 숨김). 점선은 Android 단일 변 dashed 버그가 있어 **실선**(지지 보라·저항 주황 1px, 진입 2px up/down 색). 가격 축 대신 좌측 상·하단에 범위 최고/최저 라벨, 가격선 우측 라벨 `지지 70,743`.
9. **API**: `createHttpClient` 는 `@/lib/api` index 에서 export 되지 않으므로 `@/lib/api/http`·`@/lib/api/graphql` 에서 직접 import(index 수정 없음). `getDailyCandles` 는 기존 `stockRequest`(graphql-request)를 쓰고 GraphQL 오류는 라이브러리가 throw.
10. **CORS**: `shared/cors.py` 가 `http://localhost:8082` 를 이미 허용 — 스모크(Expo web 8082)에 env 오버라이드 불필요.

---

### Task 1: 기반 — env · 타입 · decimal · format

**Files:**
- Modify: `mobile/src/lib/env.ts`
- Create: `mobile/src/features/game/types.ts`, `lib/decimal.ts`, `lib/decimal.test.ts`, `lib/format.ts`, `lib/format.test.ts`

- [ ] **Step 1: `mobile/src/lib/env.ts` 교체**(기존 4개 필드 값 유지 + `gameApiUrl` 추가. `as const` 라 타입을 명시):

```ts
/**
 * 앱 환경변수 단일 접근점.
 * EXPO_PUBLIC_ 변수는 빌드 시 인라인된다(.env.development / .env.production).
 * MSA라 서비스별 base URL이 분리돼 있다(운영은 Nginx가 한 호스트로 통합).
 */
const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

/**
 * trading_game(8003) REST·WS — 선택 변수.
 * 미설정 시 dev 는 localhost, production 이면 undefined → 게임 탭 "시즌을 준비하고 있어요".
 */
const gameApiUrl: string | undefined =
  process.env.EXPO_PUBLIC_GAME_API_URL ||
  (appEnv !== 'production' ? 'http://localhost:8003' : undefined);

export const ENV = {
  appEnv,
  stockGraphqlUrl: process.env.EXPO_PUBLIC_STOCK_GRAPHQL_URL ?? 'http://localhost:8002/graphql',
  blogApiUrl: process.env.EXPO_PUBLIC_BLOG_API_URL ?? 'http://localhost:8000',
  authApiUrl: process.env.EXPO_PUBLIC_AUTH_API_URL ?? 'http://localhost:8001',
  gameApiUrl,
} as const;

export const isDev = ENV.appEnv === 'development';
```

- [ ] **Step 2: 타입** — `mobile/src/features/game/types.ts`:

```ts
// trading_game(8003) 계약 타입 — web_client/src/types/game.ts(6a+6b)와 동일 계약.
// 출처: backend/apps/trading_game/schemas/game_dtos.py, routers/{orders,leaderboard,coach,academy,quests,quiz}.py,
//       services/{tick_listener,coach_service,connection_manager,ranking_service}.py, routers/ws_gateway.py
// pydantic v2 는 Decimal 을 JSON 문자열로 직렬화한다 → Raw* 는 문자열(Dec), 도메인 타입은 number.

export type Side = 'LONG' | 'SHORT';
export type Ratio = 0.25 | 0.5 | 1.0;
export type Leverage = 1 | 2 | 5;

/** Decimal 직렬화 값. 서버는 문자열을 보내지만 방어적으로 number 도 허용 */
export type Dec = string | number;

/** GET /api/game/seasons/active (SeasonOption) */
export interface Season {
  id: number;
  season_number: number;
  ticker: string;
  stock_name: string;
  status: string;
  start_at: string;
  end_at: string | null;
}

export interface RawAccount {
  season_id: number;
  cash_balance: Dec;
  total_asset: Dec;
  current_roi: Dec;
  total_trades: number;
  win_trades: number;
}

export interface Account {
  season_id: number;
  cash_balance: number;
  total_asset: number;
  current_roi: number;
  total_trades: number;
  win_trades: number;
}

export interface RawPosition {
  id: string;
  side: Side;
  entry_price: Dec;
  size_amount: Dec;
  leverage: number;
  stop_loss_price: Dec | null;
  take_profit_price: Dec | null;
  status: string;
  roi_pct: Dec | null;
  pnl_amount: Dec | null;
}

export interface Position {
  id: string;
  side: Side;
  entry_price: number;
  size_amount: number;
  leverage: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  status: string;
  roi_pct: number | null;
  pnl_amount: number | null;
}

/** NudgeDTO — type: WARNING | PRAISE | ADVICE */
export interface Nudge {
  type: string;
  code: string;
  message: string;
}

export interface RawOrderResult extends RawPosition {
  nudges: Nudge[];
}

export interface OrderResult {
  position: Position;
  nudges: Nudge[];
}

export interface OrderRequest {
  season_id: number;
  side: Side;
  ratio: Ratio;
  leverage: Leverage;
}

/** GET /api/game/seasons/{id}/my-rank (ranking_service.my_rank — 이미 float) */
export interface MyRank {
  rank: number | null;
  roi_pct: number | null;
  percentile: number | null;
  total: number;
}

export interface RawCoachMessage {
  id: number;
  season_id: number;
  target_date: string;
  coach_type: string;
  title: string;
  summary_nudge: string;
  content_md: string;
  support_price: Dec | null;
  resistance_price: Dec | null;
  status: string;
  published_at: string | null;
}

export interface RawCoachToday {
  target_date: string;
  season_id: number | null;
  morning: RawCoachMessage | null;
  evening: RawCoachMessage | null;
  active: RawCoachMessage | null;
}

/** 화면용 코치 — REST active 또는 WS coach 메시지(content_md 없음 → null)에서 생성 */
export interface Coach {
  season_id: number;
  coach_type: string;
  title: string;
  summary_nudge: string;
  content_md: string | null;
  support_price: number | null;
  resistance_price: number | null;
}

export interface Sentiment {
  long_pct: number;
  short_pct: number;
}

/** stock_api getChartData.candles (date = 'YYYY-MM-DD') */
export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** WS /ws/game/stream 서버→클라 메시지(파싱·정규화 후) */
export type GameWsMessage =
  | { type: 'tick'; ticker: string; price: number }
  | { type: 'position_pnl'; position_id: string; roi_pct: number; pnl_amount: number }
  | ({ type: 'sentiment' } & Sentiment)
  | { type: 'nudge'; position_id: string; nudge: Nudge }
  | { type: 'coach'; coach: Coach };

// ---------------------------------------------------------------- 6b: 모달(랭킹·퀘스트·아카데미·퀴즈·Streak)

/** GET /api/game/seasons/{id}/leaderboard (이미 float, win_rate 0~100) */
export interface LeaderboardRow {
  rank: number;
  user_id: number;
  nickname: string | null;
  roi_pct: number;
  total_asset: number | null;
  win_rate: number;
}

/** GET /api/game/hall-of-fame (이미 float, win_rate 0~100). 시즌 번호 없이 season_id 만 제공 */
export interface HallOfFameRow {
  season_id: number;
  rank: number;
  nickname: string;
  final_roi: number;
  final_asset: number;
  win_rate: number;
  trading_mbti: string | null;
}

export interface RawQuest {
  code: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward_cash: Dec | null;
  reward_badge: string | null;
  completed: boolean;
  claimed: boolean;
}

export interface Quest {
  code: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward_cash: number | null;
  reward_badge: string | null;
  completed: boolean;
  claimed: boolean;
}

export interface Badge {
  code: string;
  name: string;
  awarded_at: string | null;
}

export interface RawQuestList {
  quests: RawQuest[];
  badges: Badge[];
}

export interface QuestList {
  quests: Quest[];
  badges: Badge[];
}

export interface RawClaimResult {
  quest: RawQuest;
  cash_balance: Dec | null;
  badge: Badge | null;
}

export interface ClaimResult {
  quest: Quest;
  cash_balance: number | null;
  badge: Badge | null;
}

export interface AcademyQuestion {
  id: number;
  question: string;
  choices: string[];
}

export interface AcademyQuiz {
  unlocked: boolean;
  questions: AcademyQuestion[];
}

export interface AcademyResultItem {
  id: number;
  correct: boolean;
  /** 정답 선택지 인덱스(0-based) */
  answer: number;
  explanation: string;
}

export interface AcademySubmitResult {
  unlocked: boolean;
  results: AcademyResultItem[];
}

/** 퀴즈 차트 캔들(첫 종가=100 정규화, 날짜 없음) */
export interface QuizCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** GET /api/game/quiz/random — chart_snapshot 은 list[dict](스키마 없음) → api 계층에서 검증·변환 */
export interface RawQuizQuestion {
  id: number;
  chart_snapshot: Record<string, unknown>[];
  time_limit_sec: number;
}

export interface QuizQuestion {
  id: number;
  chart_snapshot: QuizCandle[];
  time_limit_sec: number;
}

export type QuizChoice = 'UP' | 'DOWN';

/** GET /api/game/streak/my (StreakResponse) */
export interface Streak {
  current_streak: number;
  highest_streak: number;
  last_activity_date: string | null;
  enabled: boolean;
}

export interface RawQuizResult {
  correct: boolean;
  answer: QuizChoice;
  actual_change: Dec;
  pattern_type: string;
  explanation: string;
  rewarded: boolean;
  reward_cash: number;
  timed_out: boolean;
  ticker: string;
  base_date: string;
  streak: Streak | null;
}

export interface QuizResult {
  correct: boolean;
  answer: QuizChoice;
  /** 기준일 대비 5거래일 후 등락률(%) */
  actual_change: number;
  pattern_type: string;
  explanation: string;
  rewarded: boolean;
  reward_cash: number;
  timed_out: boolean;
  ticker: string;
  base_date: string;
  streak: Streak | null;
}
```

- [ ] **Step 3: 실패하는 테스트 작성** — `mobile/src/features/game/lib/decimal.test.ts`:

```ts
import { toNum, toNumOrNull } from './decimal';

describe('toNumOrNull', () => {
  test('Decimal 문자열 → number', () => {
    expect(toNumOrNull('71200.50')).toBe(71200.5);
  });
  test('유한 number 는 그대로', () => {
    expect(toNumOrNull(-3)).toBe(-3);
  });
  test('빈 문자열·공백·NaN·Infinity·null·객체 → null', () => {
    expect(toNumOrNull('')).toBeNull();
    expect(toNumOrNull('  ')).toBeNull();
    expect(toNumOrNull('abc')).toBeNull();
    expect(toNumOrNull(Number.NaN)).toBeNull();
    expect(toNumOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumOrNull(null)).toBeNull();
    expect(toNumOrNull({})).toBeNull();
  });
});

describe('toNum', () => {
  test('변환 성공', () => {
    expect(toNum('10000000.00')).toBe(10000000);
  });
  test('변환 불가면 예외', () => {
    expect(() => toNum(null)).toThrow('숫자 변환 실패');
  });
});
```

- [ ] **Step 4: 실패하는 테스트 작성** — `mobile/src/features/game/lib/format.test.ts`:

```ts
import { daysUntil, formatPrice, kstDateString, pnlTone } from './format';

describe('formatPrice', () => {
  test('천단위 콤마(원 단위 반올림)', () => {
    expect(formatPrice(71200)).toBe('71,200');
    expect(formatPrice(1234567.6)).toBe('1,234,568');
  });
});

describe('kstDateString', () => {
  test('UTC 15:00 이후는 KST 다음 날', () => {
    expect(kstDateString(new Date('2026-10-13T15:00:00Z'))).toBe('2026-10-14');
  });
  test('UTC 14:59 는 KST 같은 날', () => {
    expect(kstDateString(new Date('2026-10-13T14:59:59Z'))).toBe('2026-10-13');
  });
});

describe('daysUntil', () => {
  const now = new Date('2026-10-13T01:00:00Z'); // KST 10-13 10:00
  test('end 없음 → null', () => {
    expect(daysUntil(null, now)).toBeNull();
  });
  test('KST 날짜 차', () => {
    expect(daysUntil('2026-10-20T14:00:00Z', now)).toBe(7); // KST 10-20 23:00
    expect(daysUntil('2026-10-20T15:00:00Z', now)).toBe(8); // KST 10-21 00:00
  });
  test('오늘 종료 → 0, 지남 → 0', () => {
    expect(daysUntil('2026-10-13T10:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('pnlTone', () => {
  test('양수 up · 음수 down · 0/없음 neutral', () => {
    expect(pnlTone(1)).toBe('up');
    expect(pnlTone(-0.1)).toBe('down');
    expect(pnlTone(0)).toBe('neutral');
    expect(pnlTone(null)).toBe('neutral');
    expect(pnlTone(undefined)).toBe('neutral');
  });
});
```

- [ ] **Step 5: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/decimal.test.ts src/features/game/lib/format.test.ts
```
기대: FAIL — `Cannot find module './decimal'` / `'./format'`

- [ ] **Step 6: 구현** — `mobile/src/features/game/lib/decimal.ts`:

```ts
// pydantic Decimal(JSON 문자열) 또는 number → 유한 number. (web lib/decimal.ts 와 동일)

/** 변환 불가(빈 문자열·NaN·Infinity·그 외 타입)면 null */
export function toNumOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 필수 숫자 필드용 — 변환 불가면 예외(조용한 NaN 표시 방지) */
export function toNum(v: unknown): number {
  const n = toNumOrNull(v);
  if (n === null) throw new Error(`숫자 변환 실패: ${String(v)}`);
  return n;
}
```

- [ ] **Step 7: 구현** — `mobile/src/features/game/lib/format.ts`:

```ts
// 게임 화면 전용 표시 함수(가격 콤마·KST 날짜·D-day·손익 톤).
// 원화/퍼센트는 공용 @/ui 의 formatWon/formatSignedWon/formatPct 를 쓴다.

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** 가격(원 단위 콤마): 71200 → '71,200'. Hermes Intl 로케일 차이를 피하려고 @/ui 처럼 en-US 콤마 사용 */
export const formatPrice = (n: number): string => Math.round(n).toLocaleString('en-US');

/** 손익 톤 — 양수 up(빨강) / 음수 down(파랑) / 0·없음 neutral. 색 매핑은 컴포넌트(theme.colors)에서 */
export type PnlTone = 'up' | 'down' | 'neutral';
export const pnlTone = (n: number | null | undefined): PnlTone =>
  n == null || n === 0 ? 'neutral' : n > 0 ? 'up' : 'down';

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 종료 시각까지 남은 일수(KST 날짜 차). end 없음 → null, 지남 → 0 */
export function daysUntil(endIso: string | null, now: Date = new Date()): number | null {
  if (!endIso) return null;
  const end = Date.parse(kstDateString(new Date(endIso)));
  const today = Date.parse(kstDateString(now));
  return Math.max(0, Math.round((end - today) / DAY_MS));
}
```

- [ ] **Step 8: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/decimal.test.ts src/features/game/lib/format.test.ts
```
기대: PASS.

- [ ] **Step 9: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 10: 커밋**

```bash
git add mobile/src/lib/env.ts mobile/src/features/game/types.ts mobile/src/features/game/lib/decimal.ts mobile/src/features/game/lib/decimal.test.ts mobile/src/features/game/lib/format.ts mobile/src/features/game/lib/format.test.ts
git commit -m "feat(mobile): 게임 기반 — gameApiUrl 선택 변수·게임 타입·Decimal 변환·가격/KST/D-day 포맷

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 순수 로직 — 캔들 병합 · WS 파서 · 오류 문구 · 퀴즈 시간

**Files:** Create `mobile/src/features/game/lib/{candles,ws,errors,quiz}.ts` + 각 `.test.ts`

web `lib/{candles,gameWs,gameErrors,quiz}.ts` 와 같은 시그니처·문구. `errors.ts` 만 axios 대신 모바일 `ApiError`(`status`·`body`)를 판별하고, `ApiError` 가 아니면(fetch `TypeError` 등) 네트워크 문구. `candles.ts` 엔 배열 반영 헬퍼 `applyTick` 을 추가(차트 state 갱신용).

- [ ] **Step 1: 실패하는 테스트 작성** — `mobile/src/features/game/lib/candles.test.ts`:

```ts
import { applyTick, mergeTick } from './candles';
import type { DailyCandle } from '../types';

const c = (date: string, o: number, h: number, l: number, cl: number): DailyCandle => ({
  date,
  open: o,
  high: h,
  low: l,
  close: cl,
});

describe('mergeTick', () => {
  test('마지막 캔들 없음 → 오늘 캔들 신규(OHLC 모두 price)', () => {
    expect(mergeTick(null, '2026-10-13', 100)).toEqual(c('2026-10-13', 100, 100, 100, 100));
  });
  test('오늘 캔들에 병합 — 고가/저가 확장, 종가 갱신, 원본 불변', () => {
    const last = c('2026-10-13', 100, 105, 95, 101);
    expect(mergeTick(last, '2026-10-13', 110)).toEqual(c('2026-10-13', 100, 110, 95, 110));
    expect(mergeTick(last, '2026-10-13', 90)).toEqual(c('2026-10-13', 100, 105, 90, 90));
    expect(last).toEqual(c('2026-10-13', 100, 105, 95, 101));
  });
  test('마지막 캔들이 과거 → 오늘 캔들 신규', () => {
    expect(mergeTick(c('2026-10-12', 1, 2, 1, 2), '2026-10-13', 50)).toEqual(c('2026-10-13', 50, 50, 50, 50));
  });
  test('시계 오차로 마지막 캔들이 더 최신 → 그 캔들에 병합(날짜 유지)', () => {
    expect(mergeTick(c('2026-10-14', 100, 100, 100, 100), '2026-10-13', 120)).toEqual(
      c('2026-10-14', 100, 120, 100, 120),
    );
  });
});

describe('applyTick', () => {
  test('빈 배열 → 오늘 캔들 1개', () => {
    expect(applyTick([], '2026-10-13', 100)).toEqual([c('2026-10-13', 100, 100, 100, 100)]);
  });
  test('같은 날 → 마지막 교체(길이 유지, 원본 불변)', () => {
    const src = [c('2026-10-12', 1, 1, 1, 1), c('2026-10-13', 100, 100, 100, 100)];
    const out = applyTick(src, '2026-10-13', 120);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(c('2026-10-13', 100, 120, 100, 120));
    expect(src[1].close).toBe(100);
  });
  test('새 날 → 뒤에 추가', () => {
    const out = applyTick([c('2026-10-12', 1, 1, 1, 1)], '2026-10-13', 7);
    expect(out.map((x) => x.date)).toEqual(['2026-10-12', '2026-10-13']);
  });
});
```

- [ ] **Step 2: 실패하는 테스트 작성** — `mobile/src/features/game/lib/ws.test.ts`:

```ts
import { parseGameMessage } from './ws';

describe('parseGameMessage', () => {
  test('tick — Decimal 문자열 가격을 number 로', () => {
    expect(parseGameMessage('{"type":"tick","ticker":"005930","price":"71200"}')).toEqual({
      type: 'tick',
      ticker: '005930',
      price: 71200,
    });
  });
  test('position_pnl', () => {
    expect(
      parseGameMessage('{"type":"position_pnl","position_id":"p1","roi_pct":"1.5","pnl_amount":"15000.00"}'),
    ).toEqual({ type: 'position_pnl', position_id: 'p1', roi_pct: 1.5, pnl_amount: 15000 });
  });
  test('sentiment', () => {
    expect(parseGameMessage('{"type":"sentiment","long_pct":60,"short_pct":40}')).toEqual({
      type: 'sentiment',
      long_pct: 60,
      short_pct: 40,
    });
  });
  test('nudge — 필드 누락이면 null', () => {
    expect(
      parseGameMessage('{"type":"nudge","position_id":"p1","nudge":{"type":"WARNING","code":"C","message":"m"}}'),
    ).toEqual({ type: 'nudge', position_id: 'p1', nudge: { type: 'WARNING', code: 'C', message: 'm' } });
    expect(parseGameMessage('{"type":"nudge","position_id":"p1","nudge":{"type":"WARNING"}}')).toBeNull();
  });
  test('coach — 본문 없음(content_md null), 가격 Decimal 변환', () => {
    expect(
      parseGameMessage(
        '{"type":"coach","season_id":1,"coach_type":"MORNING","title":"t","summary_nudge":"s","support_price":"70000","resistance_price":null}',
      ),
    ).toEqual({
      type: 'coach',
      coach: {
        season_id: 1,
        coach_type: 'MORNING',
        title: 't',
        summary_nudge: 's',
        content_md: null,
        support_price: 70000,
        resistance_price: null,
      },
    });
  });
  test('깨진 JSON·배열·모르는 type·필수값 누락 → null', () => {
    expect(parseGameMessage('pong')).toBeNull();
    expect(parseGameMessage('[]')).toBeNull();
    expect(parseGameMessage('{"type":"x"}')).toBeNull();
    expect(parseGameMessage('{"type":"tick","ticker":"","price":1}')).toBeNull();
    expect(parseGameMessage('{"type":"tick","ticker":"005930","price":"abc"}')).toBeNull();
  });
});
```

- [ ] **Step 3: 실패하는 테스트 작성** — `mobile/src/features/game/lib/errors.test.ts`:

```ts
import { ApiError } from '@/lib/api/http';

import { apiErrorCode, gameErrorMessage, orderErrorMessage } from './errors';

const api = (status: number, body?: unknown) => new ApiError(status, `HTTP ${status}`, body);

describe('gameErrorMessage', () => {
  test('ApiError 아님(fetch TypeError 등) → 네트워크 문구', () => {
    expect(gameErrorMessage(new TypeError('Network request failed'))).toBe('게임 서버에 연결할 수 없어요');
  });
  test('401 → 로그인 만료', () => {
    expect(gameErrorMessage(api(401, { detail: 'x' }))).toBe('로그인이 만료되었어요. 다시 로그인해 주세요');
  });
  test('객체 detail code 고정 문구', () => {
    expect(gameErrorMessage(api(404, { detail: { code: 'NO_QUIZ_AVAILABLE', message: 'm' } }))).toBe(
      '준비된 문제를 모두 풀었어요',
    );
    expect(gameErrorMessage(api(503, { detail: { code: 'FEATURE_DISABLED', message: 'm' } }))).toBe(
      '지금은 운영하지 않는 기능이에요',
    );
    expect(gameErrorMessage(api(403, { detail: { code: 'LEVERAGE_LOCKED', message: 'm' } }))).toBe(
      '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요',
    );
  });
  test('모르는 code → message', () => {
    expect(gameErrorMessage(api(400, { detail: { code: 'NEW_CODE', message: '새 오류' } }))).toBe('새 오류');
  });
  test('문자열 detail(403/404/409/422) → 그대로', () => {
    expect(gameErrorMessage(api(409, { detail: '이미 보유 중인 포지션이 있습니다' }))).toBe(
      '이미 보유 중인 포지션이 있습니다',
    );
  });
  test('그 외 상태·본문 없음 → 네트워크 문구', () => {
    expect(gameErrorMessage(api(500, 'Internal Server Error'))).toBe('게임 서버에 연결할 수 없어요');
    expect(gameErrorMessage(api(400, { detail: '문자열' }))).toBe('게임 서버에 연결할 수 없어요');
  });
});

describe('apiErrorCode', () => {
  test('객체 detail 의 code 만', () => {
    expect(apiErrorCode(api(503, { detail: { code: 'FEATURE_DISABLED' } }))).toBe('FEATURE_DISABLED');
    expect(apiErrorCode(api(409, { detail: '문자열' }))).toBeNull();
    expect(apiErrorCode(new Error('x'))).toBeNull();
  });
});

describe('orderErrorMessage', () => {
  test('422 배열 detail(검증 오류) → 주문 조건 문구', () => {
    expect(orderErrorMessage(api(422, { detail: [{ loc: ['body', 'ratio'], msg: 'bad' }] }))).toBe(
      '주문 조건이 올바르지 않아요',
    );
  });
  test('422 문자열 detail → 그대로', () => {
    expect(orderErrorMessage(api(422, { detail: '거래 가능 시간이 아닙니다' }))).toBe('거래 가능 시간이 아닙니다');
  });
  test('나머지는 gameErrorMessage 와 동일', () => {
    expect(orderErrorMessage(api(409, { detail: '이미 보유 중' }))).toBe('이미 보유 중');
    expect(orderErrorMessage(new TypeError('x'))).toBe('게임 서버에 연결할 수 없어요');
  });
});
```

- [ ] **Step 4: 실패하는 테스트 작성** — `mobile/src/features/game/lib/quiz.test.ts`:

```ts
import { isQuizPrimeTime, quizSecondsLeft } from './quiz';

describe('isQuizPrimeTime (KST)', () => {
  test('평일 15:29 → false, 15:30 → true', () => {
    // 2026-10-13(화) KST 15:29 = UTC 06:29
    expect(isQuizPrimeTime(new Date('2026-10-13T06:29:00Z'))).toBe(false);
    expect(isQuizPrimeTime(new Date('2026-10-13T06:30:00Z'))).toBe(true);
  });
  test('평일 23:59 → true, 다음 날 00:00(평일) → false', () => {
    expect(isQuizPrimeTime(new Date('2026-10-13T14:59:00Z'))).toBe(true);
    expect(isQuizPrimeTime(new Date('2026-10-13T15:00:00Z'))).toBe(false); // KST 10-14(수) 00:00
  });
  test('토/일 종일 → true', () => {
    expect(isQuizPrimeTime(new Date('2026-10-17T01:00:00Z'))).toBe(true); // KST 토 10:00
    expect(isQuizPrimeTime(new Date('2026-10-18T01:00:00Z'))).toBe(true); // KST 일 10:00
  });
});

describe('quizSecondsLeft', () => {
  test('시작 순간 = limit, 정확히 limit 경과 = 0', () => {
    expect(quizSecondsLeft(1000, 10, 1000)).toBe(10);
    expect(quizSecondsLeft(1000, 10, 11000)).toBe(0);
  });
  test('올림 — 0.1초 남으면 1', () => {
    expect(quizSecondsLeft(0, 10, 9900)).toBe(1);
    expect(quizSecondsLeft(0, 10, 200)).toBe(10);
  });
  test('초과는 0', () => {
    expect(quizSecondsLeft(0, 10, 99999)).toBe(0);
  });
});
```

- [ ] **Step 5: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/candles.test.ts src/features/game/lib/ws.test.ts src/features/game/lib/errors.test.ts src/features/game/lib/quiz.test.ts
```
기대: FAIL — 4개 스위트 모두 `Cannot find module` (`./candles`·`./ws`·`./errors`·`./quiz`)

- [ ] **Step 6: 구현** — `mobile/src/features/game/lib/candles.ts`:

```ts
import type { DailyCandle } from '../types';

/**
 * 틱 가격을 마지막 일봉에 병합(원본 불변). (web lib/candles.ts 와 동일)
 * 마지막 캔들 날짜가 today 이상이면(시계 오차로 last 가 더 최신인 경우 포함) last 에 병합해 날짜를 유지,
 * 마지막 캔들이 없거나 더 과거면 오늘 캔들 신규 생성.
 */
export function mergeTick(last: DailyCandle | null, today: string, price: number): DailyCandle {
  if (last && last.date >= today) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
  }
  return { date: today, open: price, high: price, low: price, close: price };
}

/** 캔들 배열에 틱 반영(새 배열). 같은 캔들에 병합되면 마지막 교체, 새 캔들이면 뒤에 추가 */
export function applyTick(candles: DailyCandle[], today: string, price: number): DailyCandle[] {
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const next = mergeTick(last, today, price);
  return last !== null && next.date === last.date ? [...candles.slice(0, -1), next] : [...candles, next];
}
```

- [ ] **Step 7: 구현** — `mobile/src/features/game/lib/ws.ts`:

```ts
import { toNumOrNull } from './decimal';
import type { GameWsMessage } from '../types';

// WS 원문(JSON 문자열) → 판별 유니온. 형식이 틀리거나 모르는 type 은 null(무시) — (web lib/gameWs.ts 와 동일)
// 백엔드에 새 메시지 type 이 추가돼도 기존 클라이언트가 깨지지 않게 한다.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function parseGameMessage(raw: string): GameWsMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;

  switch (data.type) {
    case 'tick': {
      const ticker = str(data.ticker);
      const price = toNumOrNull(data.price);
      return ticker !== null && price !== null ? { type: 'tick', ticker, price } : null;
    }
    case 'position_pnl': {
      const id = str(data.position_id);
      const roi = toNumOrNull(data.roi_pct);
      const pnl = toNumOrNull(data.pnl_amount);
      return id !== null && roi !== null && pnl !== null
        ? { type: 'position_pnl', position_id: id, roi_pct: roi, pnl_amount: pnl }
        : null;
    }
    case 'sentiment': {
      const long = toNumOrNull(data.long_pct);
      const short = toNumOrNull(data.short_pct);
      return long !== null && short !== null ? { type: 'sentiment', long_pct: long, short_pct: short } : null;
    }
    case 'nudge': {
      const id = str(data.position_id);
      const n = data.nudge;
      if (id === null || !isObj(n)) return null;
      const type = str(n.type);
      const code = str(n.code);
      const message = str(n.message);
      return type !== null && code !== null && message !== null
        ? { type: 'nudge', position_id: id, nudge: { type, code, message } }
        : null;
    }
    case 'coach': {
      const seasonId = toNumOrNull(data.season_id);
      const title = str(data.title);
      const summary = str(data.summary_nudge);
      if (seasonId === null || title === null || summary === null) return null;
      return {
        type: 'coach',
        coach: {
          season_id: seasonId,
          coach_type: str(data.coach_type) ?? '',
          title,
          summary_nudge: summary,
          content_md: null, // WS 페이로드에는 본문이 없다
          support_price: toNumOrNull(data.support_price),
          resistance_price: toNumOrNull(data.resistance_price),
        },
      };
    }
    default:
      return null;
  }
}
```

- [ ] **Step 8: 구현** — `mobile/src/features/game/lib/errors.ts`:

```ts
// 게임 API 실패 → 사용자 문구. (web lib/gameErrors.ts 와 같은 문구·규칙, axios 대신 모바일 ApiError)
// detail 이 문자열(주문 409/422 등, 이미 한국어 문장)이면 그대로, 객체 {code, message}(퀘스트·퀴즈·레버리지 잠금)면
// code 별 고정 문구 → 없으면 message. ApiError 가 아니면(fetch TypeError 등) 네트워크 문구.
// 주의: '@/lib/api'(index) 는 graphql-request 를 끌어오므로 http 모듈만 직접 import 한다.
import { ApiError } from '@/lib/api/http';

const NETWORK = '게임 서버에 연결할 수 없어요';
const EXPIRED = '로그인이 만료되었어요. 다시 로그인해 주세요';

const CODE_MESSAGES = new Map<string, string>([
  ['NO_QUIZ_AVAILABLE', '준비된 문제를 모두 풀었어요'],
  ['FEATURE_DISABLED', '지금은 운영하지 않는 기능이에요'],
  ['QUIZ_NOT_SERVED', '이미 제출했거나 만료된 문제예요'],
  ['ALREADY_SUBMITTED', '이미 제출했거나 만료된 문제예요'],
  ['QUEST_NOT_COMPLETED', '아직 완료하지 않은 퀘스트예요'],
  ['ALREADY_CLAIMED', '이미 받은 보상이에요'],
  ['NO_ACTIVE_SEASON', '진행 중인 시즌이 없어요'],
  ['PRICE_UNAVAILABLE', '시세를 확인할 수 없어요. 잠시 후 다시 시도해 주세요'],
  ['LEVERAGE_LOCKED', '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요'],
]);

/** 응답 본문의 detail(문자열·객체·배열) — ApiError 가 아니거나 detail 이 없으면 undefined */
function errorDetail(err: unknown): unknown {
  if (!(err instanceof ApiError)) return undefined;
  const body = err.body;
  return typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
}

/** 객체 detail 의 code(문자열일 때만), 없으면 null */
export function apiErrorCode(err: unknown): string | null {
  const detail = errorDetail(err);
  if (typeof detail === 'object' && detail !== null && 'code' in detail && typeof detail.code === 'string') {
    return detail.code;
  }
  return null;
}

export function gameErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK;
  const { status } = err;
  if (status === 401) return EXPIRED;
  const code = apiErrorCode(err);
  const mapped = code === null ? undefined : CODE_MESSAGES.get(code);
  if (mapped !== undefined) return mapped;
  const detail = errorDetail(err);
  if (typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string') {
    return detail.message;
  }
  if ((status === 403 || status === 404 || status === 409 || status === 422) && typeof detail === 'string') {
    return detail;
  }
  return NETWORK;
}

/** 주문/청산 실패 — 422 검증 오류(배열 detail)는 '주문 조건이 올바르지 않아요', 나머지는 gameErrorMessage */
export function orderErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 422) {
    const detail = errorDetail(err);
    if (typeof detail !== 'string') return '주문 조건이 올바르지 않아요';
  }
  return gameErrorMessage(err);
}
```

- [ ] **Step 9: 구현** — `mobile/src/features/game/lib/quiz.ts`:

```ts
// 야간 차트 퀴즈 순수 함수(시간 판정·카운트다운). (web lib/quiz.ts 와 동일)

const KST_OFFSET_MS = 9 * 3_600_000;
const PRIME_START_MIN = 15 * 60 + 30; // KST 15:30 (정규장 마감)

/** 퀴즈 강조 시간 — KST 평일 15:30~24:00, 또는 토/일 종일 */
export function isQuizPrimeTime(now: Date): boolean {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const day = kst.getUTCDay(); // 0=일 … 6=토 (KST 기준)
  if (day === 0 || day === 6) return true;
  return kst.getUTCHours() * 60 + kst.getUTCMinutes() >= PRIME_START_MIN;
}

/** 남은 초(올림, 0 미만은 0). startedAtMs/nowMs 는 epoch ms. 시작 순간 = limitSec, 정확히 limitSec 경과 = 0 */
export function quizSecondsLeft(startedAtMs: number, limitSec: number, nowMs: number): number {
  const remainMs = startedAtMs + limitSec * 1000 - nowMs;
  return remainMs <= 0 ? 0 : Math.ceil(remainMs / 1000);
}
```

- [ ] **Step 10: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/candles.test.ts src/features/game/lib/ws.test.ts src/features/game/lib/errors.test.ts src/features/game/lib/quiz.test.ts
```
기대: PASS.

- [ ] **Step 11: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 12: 커밋**

```bash
git add mobile/src/features/game/lib/candles.ts mobile/src/features/game/lib/candles.test.ts mobile/src/features/game/lib/ws.ts mobile/src/features/game/lib/ws.test.ts mobile/src/features/game/lib/errors.ts mobile/src/features/game/lib/errors.test.ts mobile/src/features/game/lib/quiz.ts mobile/src/features/game/lib/quiz.test.ts
git commit -m "feat(mobile): 게임 순수 로직 — 캔들 틱 병합·WS 파서·오류 문구(ApiError)·퀴즈 시간

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 차트 좌표 — `chart-layout`

**Files:** Create `mobile/src/features/game/lib/chart-layout.ts`, `chart-layout.test.ts`

y 축은 위가 고가, 위·아래 `CHART_PAD_Y=8` 패딩. 범위 = 캔들 저가 최소~고가 최대 ∪ 가격선(null·NaN 무시), min=max 면 ±1. 슬롯 폭 = width/n, 몸통은 슬롯 중앙 60%(최소 1px), 꼬리 1px 중앙, 몸통 높이 최소 1px. 캔들 없음·폭/높이 0 이하(onLayout 전) → `null`.

- [ ] **Step 1: 실패하는 테스트 작성** — `mobile/src/features/game/lib/chart-layout.test.ts`:

```ts
import { CHART_PAD_Y, layoutCandles, priceRange, priceToY } from './chart-layout';

const k = (open: number, high: number, low: number, close: number) => ({ open, high, low, close });

describe('priceRange', () => {
  test('저가 최소~고가 최대', () => {
    expect(priceRange([k(100, 110, 90, 105), k(105, 120, 100, 101)], [])).toEqual({ min: 90, max: 120 });
  });
  test('가격선(지지/저항/진입)이 범위 밖이면 포함하도록 확장, null 은 무시', () => {
    expect(priceRange([k(100, 110, 90, 105)], [80, null, 130])).toEqual({ min: 80, max: 130 });
  });
  test('NaN/Infinity 가격선은 무시', () => {
    expect(priceRange([k(100, 110, 90, 105)], [Number.NaN, Number.POSITIVE_INFINITY])).toEqual({ min: 90, max: 110 });
  });
  test('평평한 차트(min=max) → ±1 확장(0 나누기 방지)', () => {
    expect(priceRange([k(100, 100, 100, 100)], [])).toEqual({ min: 99, max: 101 });
  });
  test('캔들 없음 → null(가격선만 있어도 null)', () => {
    expect(priceRange([], [])).toBeNull();
    expect(priceRange([], [100])).toBeNull();
  });
});

describe('priceToY', () => {
  const range = { min: 100, max: 200 };
  test('max → 위쪽 패딩, min → 아래쪽 패딩', () => {
    expect(priceToY(200, range, 216)).toBe(CHART_PAD_Y);
    expect(priceToY(100, range, 216)).toBe(216 - CHART_PAD_Y);
  });
  test('중간 가격 → 가운데(선형)', () => {
    expect(priceToY(150, range, 216)).toBe(108);
  });
  test('패딩 지정', () => {
    expect(priceToY(200, range, 100, 0)).toBe(0);
    expect(priceToY(100, range, 100, 0)).toBe(100);
  });
});

describe('layoutCandles', () => {
  test('빈 입력 또는 폭/높이 0 이하 → null', () => {
    expect(layoutCandles([], 300, 200)).toBeNull();
    expect(layoutCandles([k(1, 2, 0, 1)], 0, 200)).toBeNull();
    expect(layoutCandles([k(1, 2, 0, 1)], 300, 0)).toBeNull();
  });
  test('슬롯 폭 = width / n, 몸통은 슬롯 중앙 60%, 꼬리는 1px 중앙', () => {
    const out = layoutCandles([k(100, 110, 90, 105), k(105, 110, 90, 95)], 200, 216);
    expect(out).not.toBeNull();
    if (out === null) return;
    expect(out.slot).toBe(100);
    const [a, b] = out.bars;
    expect(a.bodyWidth).toBe(60);
    expect(a.bodyLeft).toBe(20);
    expect(b.bodyLeft).toBe(120);
    expect(a.wickLeft).toBe(49.5);
    expect(b.wickLeft).toBe(149.5);
  });
  test('상승(close>=open)/하락 판정과 y 좌표(몸통=open·close, 꼬리=high·low)', () => {
    // range 90~110, height 216, pad 8 → 1원 = 10px, y(110)=8, y(90)=208
    const out = layoutCandles([k(100, 110, 90, 105), k(105, 110, 90, 95), k(100, 100, 100, 100)], 300, 216);
    if (out === null) throw new Error('layout null');
    const [up, down, flat] = out.bars;
    expect(up.rising).toBe(true);
    expect(up.bodyTop).toBe(58); // y(105)
    expect(up.bodyHeight).toBe(50); // y(100)-y(105)
    expect(up.wickTop).toBe(8);
    expect(up.wickHeight).toBe(200);
    expect(down.rising).toBe(false);
    expect(down.bodyTop).toBe(58); // y(105) — 하락은 open 이 위
    expect(down.bodyHeight).toBe(100); // y(95)-y(105)
    expect(flat.rising).toBe(true);
    expect(flat.bodyHeight).toBe(1); // 시가=종가여도 최소 1px
  });
  test('슬롯이 좁아도 몸통 최소 1px', () => {
    const many = Array.from({ length: 60 }, () => k(100, 110, 90, 105));
    const out = layoutCandles(many, 30, 100);
    if (out === null) throw new Error('layout null');
    expect(out.bars).toHaveLength(60);
    expect(out.bars[0].bodyWidth).toBe(1);
  });
  test('가격선 포함 범위가 결과 range 에 반영', () => {
    const out = layoutCandles([k(100, 110, 90, 105)], 100, 100, [150]);
    expect(out?.range).toEqual({ min: 90, max: 150 });
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd mobile && npx jest src/features/game/lib/chart-layout.test.ts
```
기대: FAIL — `Cannot find module './chart-layout'`

- [ ] **Step 3: 구현** — `mobile/src/features/game/lib/chart-layout.ts`:

```ts
// 순수 View 캔들 차트의 좌표 계산(네이티브 의존성 없음). 컴포넌트는 결과를 절대 배치만 한다.
// y 축: 위가 고가. 위·아래 CHART_PAD_Y 만큼 여백을 두어 꼬리/가격선이 테두리에 붙지 않게 한다.

export const CHART_PAD_Y = 8;
const BODY_RATIO = 0.6;

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface CandleBar {
  /** 몸통 좌측 x(px) */
  bodyLeft: number;
  bodyWidth: number;
  bodyTop: number;
  /** 최소 1px(시가=종가여도 보이게) */
  bodyHeight: number;
  /** 1px 꼬리의 좌측 x(px) — 슬롯 중앙 */
  wickLeft: number;
  wickTop: number;
  wickHeight: number;
  /** close >= open → 상승(빨강) */
  rising: boolean;
}

export interface CandleLayout {
  range: PriceRange;
  /** 캔들 1개가 차지하는 가로 폭 */
  slot: number;
  bars: CandleBar[];
}

/** 캔들 저가 최소~고가 최대 + 가격선(지지/저항/진입) 포함. 캔들 없으면 null. min=max 면 ±1 확장 */
export function priceRange(candles: Ohlc[], extraPrices: (number | null)[]): PriceRange | null {
  if (candles.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of candles) {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  }
  for (const p of extraPrices) {
    if (p === null || !Number.isFinite(p)) continue;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

/** 가격 → y(px). max → pad, min → height - pad, 선형 */
export function priceToY(price: number, range: PriceRange, height: number, pad: number = CHART_PAD_Y): number {
  const inner = height - pad * 2;
  return pad + ((range.max - price) / (range.max - range.min)) * inner;
}

/** 캔들 좌표 일괄 계산. 빈 입력·폭/높이 0 이하(onLayout 전)면 null */
export function layoutCandles(
  candles: Ohlc[],
  width: number,
  height: number,
  extraPrices: (number | null)[] = [],
): CandleLayout | null {
  if (width <= 0 || height <= 0) return null;
  const range = priceRange(candles, extraPrices);
  if (range === null) return null;
  const slot = width / candles.length;
  const bodyWidth = Math.max(1, Math.floor(slot * BODY_RATIO));
  const y = (p: number) => priceToY(p, range, height);
  const bars = candles.map((c, i): CandleBar => {
    const rising = c.close >= c.open;
    const top = y(Math.max(c.open, c.close));
    const bottom = y(Math.min(c.open, c.close));
    const wickTop = y(c.high);
    return {
      bodyLeft: i * slot + (slot - bodyWidth) / 2,
      bodyWidth,
      bodyTop: top,
      bodyHeight: Math.max(1, bottom - top),
      wickLeft: i * slot + slot / 2 - 0.5,
      wickTop,
      wickHeight: Math.max(1, y(c.low) - wickTop),
      rising,
    };
  });
  return { range, slot, bars };
}
```

- [ ] **Step 4: 통과 확인**

```bash
cd mobile && npx jest src/features/game/lib/chart-layout.test.ts
```
기대: PASS.

- [ ] **Step 5: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 6: 커밋**

```bash
git add mobile/src/features/game/lib/chart-layout.ts mobile/src/features/game/lib/chart-layout.test.ts
git commit -m "feat(mobile): 캔들 차트 좌표 계산 — 가격 범위(가격선 포함)·가격→y·캔들 바 배치

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: API 계층 — `features/game/api.ts`

**Files:** Create `mobile/src/features/game/api.ts`

web `api/game.ts`+`api/stock.ts` 와 같은 엔드포인트·변환. `ENV.gameApiUrl` 이 없으면 클라이언트를 만들지 않고 `isGameConfigured()=false`(스토어가 `unavailable`). 401 은 기존 `http.ts` 가 `notifyUnauthorized()` → 로그아웃(모바일 공통 정책)하고, 화면의 `loggedIn → resetPrivate` effect 가 나머지를 정리한다. 순수 매핑 함수는 graphql-request 를 끌어오는 모듈이라 jest 대상이 아니다(검증은 tsc + 스모크).

- [ ] **Step 1: 구현** — `mobile/src/features/game/api.ts`:

```ts
// trading_game REST(createHttpClient) + 일봉 GraphQL(stock_api). Decimal 문자열은 여기서 number 로 변환해
// 화면/스토어는 number 만 다룬다. (web api/game.ts + api/stock.ts 와 같은 계약)
// createHttpClient 는 lib/api/index 에서 export 되지 않으므로(인스턴스만 노출) 모듈에서 직접 가져온다.
import { stockRequest } from '@/lib/api/graphql';
import { createHttpClient, type HttpClient } from '@/lib/api/http';
import { ENV } from '@/lib/env';

import { toNum, toNumOrNull } from './lib/decimal';
import { kstDateString } from './lib/format';
import type {
  AcademyQuiz,
  AcademySubmitResult,
  Account,
  ClaimResult,
  Coach,
  DailyCandle,
  HallOfFameRow,
  LeaderboardRow,
  MyRank,
  OrderRequest,
  OrderResult,
  Position,
  Quest,
  QuestList,
  QuizCandle,
  QuizChoice,
  QuizQuestion,
  QuizResult,
  RawAccount,
  RawClaimResult,
  RawCoachMessage,
  RawCoachToday,
  RawOrderResult,
  RawPosition,
  RawQuest,
  RawQuestList,
  RawQuizQuestion,
  RawQuizResult,
  Season,
  Streak,
} from './types';

/** 게임 서버 미설정(production 에 EXPO_PUBLIC_GAME_API_URL 없음)이면 null → 화면 "준비 중" */
const gameHttp: HttpClient | null = ENV.gameApiUrl ? createHttpClient(ENV.gameApiUrl) : null;

export const isGameConfigured = (): boolean => gameHttp !== null;

function client(): HttpClient {
  if (!gameHttp) throw new Error('GAME_API_URL 미설정');
  return gameHttp;
}

const toPosition = (r: RawPosition): Position => ({
  id: r.id,
  side: r.side,
  entry_price: toNum(r.entry_price),
  size_amount: toNum(r.size_amount),
  leverage: r.leverage,
  stop_loss_price: toNumOrNull(r.stop_loss_price),
  take_profit_price: toNumOrNull(r.take_profit_price),
  status: r.status,
  roi_pct: toNumOrNull(r.roi_pct),
  pnl_amount: toNumOrNull(r.pnl_amount),
});

const toAccount = (r: RawAccount): Account => ({
  season_id: r.season_id,
  cash_balance: toNum(r.cash_balance),
  total_asset: toNum(r.total_asset),
  current_roi: toNum(r.current_roi),
  total_trades: r.total_trades,
  win_trades: r.win_trades,
});

const toCoach = (m: RawCoachMessage): Coach => ({
  season_id: m.season_id,
  coach_type: m.coach_type,
  title: m.title,
  summary_nudge: m.summary_nudge,
  content_md: m.content_md,
  support_price: toNumOrNull(m.support_price),
  resistance_price: toNumOrNull(m.resistance_price),
});

const toOrderResult = (r: RawOrderResult): OrderResult => ({ position: toPosition(r), nudges: r.nudges });

const toQuest = (r: RawQuest): Quest => ({ ...r, reward_cash: toNumOrNull(r.reward_cash) });

/** 스키마 없는 dict → 캔들. OHLC 중 하나라도 숫자가 아니면 그 캔들은 버린다(차트 예외 방지) */
const toQuizCandles = (raw: Record<string, unknown>[]): QuizCandle[] => {
  const out: QuizCandle[] = [];
  for (const c of raw) {
    const open = toNumOrNull(c.open);
    const high = toNumOrNull(c.high);
    const low = toNumOrNull(c.low);
    const close = toNumOrNull(c.close);
    if (open === null || high === null || low === null || close === null) continue;
    const volume = toNumOrNull(c.volume);
    out.push(volume === null ? { open, high, low, close } : { open, high, low, close, volume });
  }
  return out;
};

const toQuizResult = (r: RawQuizResult): QuizResult => ({ ...r, actual_change: toNum(r.actual_change) });

/** 공개 — 활성 시즌 없으면 null */
export function getActiveSeason(): Promise<Season | null> {
  return client().get<Season | null>('/api/game/seasons/active');
}

export async function getMyAccount(seasonId: number): Promise<Account> {
  return toAccount(await client().get<RawAccount>('/api/game/accounts/me', { season_id: seasonId }));
}

/** 보유 포지션(서버 규칙상 최대 1개) — 없으면 null */
export async function getActivePosition(seasonId: number): Promise<Position | null> {
  const rows = await client().get<RawPosition[]>('/api/game/positions/active', { season_id: seasonId });
  return rows.length > 0 ? toPosition(rows[0]) : null;
}

export function getMyRank(seasonId: number): Promise<MyRank> {
  return client().get<MyRank>(`/api/game/seasons/${seasonId}/my-rank`);
}

/** 오늘의 코치(evening 우선 active) — 없으면 null */
export async function getTodayCoach(): Promise<Coach | null> {
  const data = await client().get<RawCoachToday>('/api/game/coach/today');
  return data.active ? toCoach(data.active) : null;
}

/** 5배 레버리지 해금 여부만(loadPrivate 용). 문항까지 필요하면 getAcademyQuiz */
export async function getAcademyUnlocked(): Promise<boolean> {
  const data = await client().get<{ unlocked: boolean }>('/api/game/academy/quiz');
  return data.unlocked;
}

export async function placeOrder(body: OrderRequest): Promise<OrderResult> {
  return toOrderResult(await client().post<RawOrderResult>('/api/game/orders', body));
}

export async function closePosition(positionId: string): Promise<OrderResult> {
  return toOrderResult(await client().post<RawOrderResult>(`/api/game/positions/${encodeURIComponent(positionId)}/close`));
}

// ---------------------------------------------------------------- 6b: 모달

/** 공개 — 시즌 Top 100 */
export function getLeaderboard(seasonId: number): Promise<LeaderboardRow[]> {
  return client().get<LeaderboardRow[]>(`/api/game/seasons/${seasonId}/leaderboard`);
}

/** 공개 — 명예의 전당(시즌 desc · 순위 asc, 최대 300) */
export function getHallOfFame(): Promise<HallOfFameRow[]> {
  return client().get<HallOfFameRow[]>('/api/game/hall-of-fame');
}

export async function getQuests(): Promise<QuestList> {
  const data = await client().get<RawQuestList>('/api/game/quests');
  return { quests: data.quests.map(toQuest), badges: data.badges };
}

export async function claimQuest(code: string): Promise<ClaimResult> {
  const data = await client().post<RawClaimResult>(`/api/game/quests/${encodeURIComponent(code)}/claim`);
  return { quest: toQuest(data.quest), cash_balance: toNumOrNull(data.cash_balance), badge: data.badge };
}

export function getAcademyQuiz(): Promise<AcademyQuiz> {
  return client().get<AcademyQuiz>('/api/game/academy/quiz');
}

/** answers: 문항 id → 선택 인덱스(0-based) */
export function submitAcademy(answers: Record<number, number>): Promise<AcademySubmitResult> {
  return client().post<AcademySubmitResult>('/api/game/academy/submit', { answers });
}

export async function getRandomQuiz(): Promise<QuizQuestion> {
  const data = await client().get<RawQuizQuestion>('/api/game/quiz/random');
  return { id: data.id, chart_snapshot: toQuizCandles(data.chart_snapshot), time_limit_sec: data.time_limit_sec };
}

export async function submitQuiz(quizId: number, choice: QuizChoice): Promise<QuizResult> {
  return toQuizResult(await client().post<RawQuizResult>(`/api/game/quiz/${quizId}/submit`, { choice }));
}

export function getMyStreak(): Promise<Streak> {
  return client().get<Streak>('/api/game/streak/my');
}

// ---------------------------------------------------------------- 일봉(stock_api GraphQL)

const DAILY_QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close }
  }
}`;

const LOOKBACK_DAYS = 180;
const DAY_MS = 86_400_000;

type DailyVars = { symbol: string; startDate: string; endDate: string };
type DailyResponse = { getChartData: { candles: DailyCandle[] } | null };

/** 최근 약 180일 일봉. GraphQL 오류(graphql-request 가 throw)·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(ticker: string, now: Date = new Date()): Promise<DailyCandle[]> {
  const data = await stockRequest<DailyResponse, DailyVars>(DAILY_QUERY, {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
    endDate: kstDateString(now),
  });
  const candles = data.getChartData?.candles;
  if (!candles || candles.length === 0) throw new Error('일봉 데이터 없음');
  return candles;
}
```

- [ ] **Step 2: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/features/game/api.ts
git commit -m "feat(mobile): 게임 API 계층 — trading_game REST(createHttpClient)·일봉 GraphQL·Decimal 변환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 상태 — zustand 스토어 + WebSocket 훅

**Files:** Create `mobile/src/features/game/store.ts`, `mobile/src/features/game/use-game-socket.ts`

스토어는 web `store/tradingGame.ts` 와 같은 상태·액션·경쟁 가드(`privateGen`·`refreshSeq`)·토스트. 차이는 서버 미설정 판정(`isGameConfigured()`) 뿐. 훅은 web `useGameWebSocket` 규칙(지수 백오프 1s→30s·4401 재연결 안 함·25초 `ping`·재연결 시 재조회) + AppState(비활성 → 소켓 닫기, 복귀 → 재연결 + `refreshTrading()`). RN `WebSocket` 핸들러 파라미터는 DOM/RN 전역 타입이 겹치므로 추론에 맡기고 `typeof e.data === 'string'` 으로 가드한다.

- [ ] **Step 1: 스토어** — `mobile/src/features/game/store.ts`:

```ts
import { create } from 'zustand';

import * as gameApi from './api';
import { orderErrorMessage } from './lib/errors';
import type {
  Account,
  Coach,
  GameWsMessage,
  Leverage,
  MyRank,
  Nudge,
  Position,
  Ratio,
  Season,
  Sentiment,
  Side,
  Streak,
} from './types';

// 트레이딩 게임 전역 상태(web store/tradingGame.ts 와 같은 상태·액션·경쟁 가드).
// 공개 데이터(시즌)와 로그인 데이터(계좌·포지션·순위·코치·해금·Streak·WS 실시간)를 분리한다.
// 모달(시트) 내부 데이터(랭킹 목록·퀘스트·문항·퀴즈 진행)는 각 시트의 로컬 state — 여기엔 화면 간 공유값만 둔다.

export type GameStatus = 'loading' | 'ready' | 'no-season' | 'unavailable' | 'error';

export interface GameToast {
  id: number;
  kind: 'nudge' | 'error' | 'info';
  icon: string;
  message: string;
}

interface PrivateState {
  account: Account | null;
  position: Position | null;
  myRank: MyRank | null;
  coach: Coach | null;
  academyUnlocked: boolean;
  streak: Streak | null;
  lastPrice: number | null;
  sentiment: Sentiment | null;
}

interface TradingGameState extends PrivateState {
  status: GameStatus;
  season: Season | null;
  submitting: boolean;
  closing: boolean;
  toasts: GameToast[];
  /** 퀴즈 API 가 503 FEATURE_DISABLED 를 준 뒤 이 세션 동안 퀴즈 진입점 숨김(로그아웃해도 유지 — 서버 전역 플래그) */
  quizDisabled: boolean;
  loadSeason: () => Promise<void>;
  loadPrivate: () => Promise<void>;
  refreshTrading: () => Promise<void>;
  refreshRank: () => Promise<void>;
  refreshStreak: () => Promise<void>;
  resetPrivate: () => void;
  placeOrder: (side: Side, ratio: Ratio, leverage: Leverage) => Promise<void>;
  closePosition: () => Promise<void>;
  applyMessage: (msg: GameWsMessage) => void;
  /** gen = 요청 시작 시점의 currentPrivateGen() — 그 사이 로그아웃했으면 무시 */
  setAcademyUnlocked: (unlocked: boolean, gen: number) => void;
  /** 퀴즈 제출 응답의 streak 반영. gen 규칙은 setAcademyUnlocked 와 동일 */
  setStreak: (streak: Streak, gen: number) => void;
  markQuizDisabled: () => void;
  pushToast: (t: Omit<GameToast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

const PRIVATE_EMPTY: PrivateState = {
  account: null,
  position: null,
  myRank: null,
  coach: null,
  academyUnlocked: false,
  streak: null,
  lastPrice: null,
  sentiment: null,
};

const NUDGE_ICON: Record<string, string> = { WARNING: '⚠️', PRAISE: '👏', ADVICE: '💡' };
let toastSeq = 0;
// 경쟁 상태 가드: privateGen은 resetPrivate(로그아웃)마다 증가 — 요청 시작 시점과 달라졌으면 늦게 도착한 응답을 버린다.
// refreshSeq는 재조회 호출 순번 — 더 최신 호출이 있으면 순서가 뒤바뀌어 도착한 이전 응답을 버린다.
let privateGen = 0;
let refreshSeq = 0;

/** 시트 등 스토어 밖에서 비동기 요청을 시작할 때 캡처 → setAcademyUnlocked/setStreak 에 전달 */
export const currentPrivateGen = (): number => privateGen;

export const useTradingGameStore = create<TradingGameState>()((set, get) => {
  const pushNudges = (nudges: Nudge[]) => {
    for (const n of nudges) get().pushToast({ kind: 'nudge', icon: NUDGE_ICON[n.type] ?? '💬', message: n.message });
  };

  /** 거래·자동청산 후 계좌/포지션/순위 재조회. 개별 실패는 무시(다음 갱신에서 회복) */
  const refreshTrading = async () => {
    const season = get().season;
    if (!season) return;
    const gen = privateGen;
    const seq = ++refreshSeq;
    const [acc, pos, rank] = await Promise.allSettled([
      gameApi.getMyAccount(season.id),
      gameApi.getActivePosition(season.id),
      gameApi.getMyRank(season.id),
    ]);
    if (gen !== privateGen || seq !== refreshSeq) return; // 로그아웃 또는 더 최신 재조회 존재 — 덮어쓰기 금지
    const patch: Partial<PrivateState> = {};
    if (acc.status === 'fulfilled') patch.account = acc.value;
    if (pos.status === 'fulfilled') patch.position = pos.value;
    if (rank.status === 'fulfilled') patch.myRank = rank.value;
    set(patch);
  };

  /** 연속 출석 재조회(주문 성공 시 서버가 touch). 실패는 무시 */
  const refreshStreak = async () => {
    const gen = privateGen;
    try {
      const streak = await gameApi.getMyStreak();
      if (gen === privateGen) set({ streak });
    } catch {
      // Streak 은 부가 정보 — 조회 실패 시 기존 값 유지
    }
  };

  return {
    ...PRIVATE_EMPTY,
    status: 'loading',
    season: null,
    submitting: false,
    closing: false,
    toasts: [],
    quizDisabled: false,

    loadSeason: async () => {
      if (!gameApi.isGameConfigured()) {
        set({ status: 'unavailable' });
        return;
      }
      // 최초 로드만 loading 표시 — 시즌이 이미 있으면(당겨서 새로고침 등) 화면 유지한 채 백그라운드 갱신
      if (get().season === null) set({ status: 'loading' });
      try {
        const season = await gameApi.getActiveSeason();
        set(season ? { status: 'ready', season } : { status: 'no-season', season: null });
      } catch {
        if (get().status !== 'ready') set({ status: 'error' }); // 이미 ready 면 현재 상태 유지
      }
    },

    loadPrivate: async () => {
      const season = get().season;
      if (!season) return;
      const gen = privateGen;
      const [, coach, academy, streak] = await Promise.allSettled([
        refreshTrading(),
        gameApi.getTodayCoach(),
        gameApi.getAcademyUnlocked(),
        gameApi.getMyStreak(),
      ]);
      const patch: Partial<PrivateState> = {};
      if (coach.status === 'fulfilled') {
        patch.coach = coach.value && coach.value.season_id === season.id ? coach.value : null;
      }
      if (academy.status === 'fulfilled') patch.academyUnlocked = academy.value;
      if (streak.status === 'fulfilled') patch.streak = streak.value;
      if (gen !== privateGen) return; // 로그아웃 후 늦게 도착한 이전 사용자 데이터 폐기
      set(patch);
    },

    refreshTrading,

    refreshRank: async () => {
      const season = get().season;
      if (!season) return;
      const gen = privateGen;
      const seq = refreshSeq;
      try {
        const rank = await gameApi.getMyRank(season.id);
        if (gen !== privateGen || seq !== refreshSeq) return; // 로그아웃 또는 폴링 중 재조회 시작 — 덮어쓰기 금지
        set({ myRank: rank });
      } catch {
        // 순위 갱신 실패는 조용히 무시(다음 주기에 재시도)
      }
    },

    refreshStreak,

    resetPrivate: () => {
      privateGen++;
      set({ ...PRIVATE_EMPTY });
    },

    placeOrder: async (side, ratio, leverage) => {
      const { season, submitting } = get();
      if (!season || submitting) return;
      const gen = privateGen;
      set({ submitting: true });
      try {
        const result = await gameApi.placeOrder({ season_id: season.id, side, ratio, leverage });
        if (gen === privateGen) {
          set({ position: result.position });
          pushNudges(result.nudges);
          void refreshStreak(); // 서버가 주문 시 연속 출석을 touch — 기다리지 않음
          await refreshTrading();
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) });
      } finally {
        set({ submitting: false });
      }
    },

    closePosition: async () => {
      const { position, closing } = get();
      if (!position || closing) return;
      const gen = privateGen;
      set({ closing: true });
      try {
        const result = await gameApi.closePosition(position.id);
        if (gen === privateGen) {
          set({ position: null });
          pushNudges(result.nudges);
          await refreshTrading();
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) });
        void refreshTrading(); // 이미 자동청산된 경우 등 — 서버 상태로 동기화
      } finally {
        set({ closing: false });
      }
    },

    applyMessage: (msg) => {
      const { season, position } = get();
      switch (msg.type) {
        case 'tick':
          if (season && msg.ticker === season.ticker) set({ lastPrice: msg.price });
          return;
        case 'position_pnl':
          if (position && position.id === msg.position_id) {
            set({ position: { ...position, roi_pct: msg.roi_pct, pnl_amount: msg.pnl_amount } });
          }
          return;
        case 'sentiment':
          set({ sentiment: { long_pct: msg.long_pct, short_pct: msg.short_pct } });
          return;
        case 'nudge':
          pushNudges([msg.nudge]);
          void refreshTrading(); // 자동청산(손절/익절/마진콜) 반영
          return;
        case 'coach':
          if (season && msg.coach.season_id === season.id) set({ coach: msg.coach });
          return;
      }
    },

    setAcademyUnlocked: (unlocked, gen) => {
      if (gen === privateGen) set({ academyUnlocked: unlocked });
    },

    setStreak: (streak, gen) => {
      if (gen === privateGen) set({ streak });
    },

    markQuizDisabled: () => set({ quizDisabled: true }),

    pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});
```

- [ ] **Step 2: WS 훅** — `mobile/src/features/game/use-game-socket.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ENV } from '@/lib/env';

import { parseGameMessage } from './lib/ws';
import { useTradingGameStore } from './store';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const PING_MS = 25_000;
const AUTH_FAILED = 4401; // 서버 ws_gateway: 토큰 무효/비활성 유저

/**
 * 게임 실시간 스트림(RN 내장 WebSocket). token 이 있고 enabled 이며 앱이 포그라운드(active)일 때만 연결한다.
 * - 끊기면 지수 백오프(1s→30s)로 재연결, 4401 이면 재연결하지 않고 onAuthFailed 호출.
 * - 재연결 성공 시 놓친 자동청산 등을 반영하려고 계좌/포지션/순위를 다시 불러온다(web 과 동일).
 * - 앱이 백그라운드로 가면 연결을 닫고(effect 정리), 포그라운드 복귀 시 재연결 + 재조회.
 */
export function useGameSocket(token: string | null, enabled: boolean, onAuthFailed: () => void): void {
  const onAuthFailedRef = useRef(onAuthFailed);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');

  // 렌더 중 ref 대입은 React Compiler 규칙 위반 — effect 에서 최신 콜백으로 갱신
  useEffect(() => {
    onAuthFailedRef.current = onAuthFailed;
  }, [onAuthFailed]);

  // 포그라운드 복귀 감지 — 비활성 동안 놓친 체결/자동청산을 재조회(연결은 아래 effect 가 appActive 로 재수립)
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const resumed = prev !== 'active' && next === 'active';
      prev = next;
      setAppActive(next === 'active');
      if (resumed && token && enabled) void useTradingGameStore.getState().refreshTrading();
    });
    return () => sub.remove();
  }, [token, enabled]);

  useEffect(() => {
    const base = ENV.gameApiUrl;
    if (!token || !enabled || !appActive || !base) return;
    const url = `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/game/stream?token=${encodeURIComponent(token)}`;
    const store = useTradingGameStore.getState;
    let ws: WebSocket | null = null;
    let stopped = false;
    let opened = false;
    let backoff = INITIAL_BACKOFF_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const sock = new WebSocket(url);
      ws = sock;
      sock.onopen = () => {
        backoff = INITIAL_BACKOFF_MS;
        if (opened) void store().refreshTrading();
        opened = true;
        pingTimer = setInterval(() => {
          if (sock.readyState === WebSocket.OPEN) sock.send('ping');
        }, PING_MS);
      };
      sock.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const msg = parseGameMessage(e.data);
        if (msg) store().applyMessage(msg);
      };
      sock.onclose = (e) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (e.code === AUTH_FAILED) {
          onAuthFailedRef.current();
          return;
        }
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [token, enabled, appActive]);
}
```

- [ ] **Step 3: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/features/game/store.ts mobile/src/features/game/use-game-socket.ts
git commit -m "feat(mobile): 게임 상태 — zustand 스토어(경쟁 가드·토스트)·WS 훅(재연결·4401·ping·AppState)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 코어 화면 컴포넌트 7종

**Files:** Create `mobile/src/features/game/components/{game-header,coach-banner,sentiment-bar,position-card,order-panel,game-toaster,quiz-banner}.tsx`

문구·조건은 web 컴포넌트(`GameHeader`·`CoachBanner`·`SentimentBar`·`ActivePositionCard`·`OrderPanel`·`NudgeToaster`·`QuizBanner`)와 동일. 금액/% 는 `@/ui` 의 `AmountText`·`formatWon`, 칩은 `@/ui` `Chip`, 청산은 `@/ui` `Button`(secondary, loading). BUY/SELL 은 up/down 배경의 56px 버튼. 토스트는 상단 오버레이·5초 자동 닫힘·탭하여 닫기, `insetTop` 으로 화면/시트 겸용.

- [ ] **Step 1:** `mobile/src/features/game/components/game-header.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Card, formatWon } from '@/ui';

import { daysUntil } from '../lib/format';
import type { Account, MyRank, Season, Streak } from '../types';

type Props = {
  season: Season;
  account: Account | null;
  myRank: MyRank | null;
  loggedIn: boolean;
  streak: Streak | null;
  /** 퀴즈 진입 버튼 노출(서버가 퀴즈 기능을 끈 경우 false) */
  showQuiz: boolean;
  onOpenRanking: () => void;
  onOpenQuest: () => void;
  onOpenQuiz: () => void;
};

function NavButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.nav, pressed && styles.pressed]}>
      <Text style={styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

/** 시즌·종목·D-day + Streak 칩 + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈 진입 버튼 */
export function GameHeader({
  season,
  account,
  myRank,
  loggedIn,
  streak,
  showQuiz,
  onOpenRanking,
  onOpenQuest,
  onOpenQuiz,
}: Props) {
  const dday = daysUntil(season.end_at);
  const rank = myRank?.rank ?? null;
  const roi = myRank?.roi_pct ?? null;
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1;

  return (
    <Card>
      <View style={styles.metaRow}>
        <Text style={styles.season}>
          시즌 {season.season_number}기{dday !== null ? ` · 종료 D-${dday}` : ''}
        </Text>
        {showStreak && streak !== null ? (
          <Text style={styles.streak} accessibilityLabel={`최고 기록 ${streak.highest_streak}일`}>
            🔥 {streak.current_streak}일 연속
          </Text>
        ) : null}
      </View>
      <Text style={styles.stock}>
        {season.stock_name} <Text style={styles.ticker}>({season.ticker})</Text>
      </Text>

      <View style={styles.rankRow}>
        {!loggedIn ? (
          <Text style={styles.muted}>로그인하고 시즌에 참여하세요</Text>
        ) : rank !== null ? (
          <View style={styles.inline}>
            <Text style={styles.rank}>내 순위 {rank}위</Text>
            {roi !== null ? <AmountText value={roi} kind="pct" size={15} /> : null}
          </View>
        ) : (
          <Text style={styles.muted}>첫 거래 후 순위가 집계돼요</Text>
        )}
      </View>

      <View style={styles.inline}>
        <Text style={styles.muted}>자본금</Text>
        <Text style={styles.asset}>{account ? formatWon(account.total_asset) : '—'}</Text>
      </View>

      <View style={styles.navRow}>
        <NavButton label="🏆 랭킹" onPress={onOpenRanking} />
        <NavButton label="🎯 퀘스트" onPress={onOpenQuest} />
        {showQuiz ? <NavButton label="🧩 퀴즈" onPress={onOpenQuiz} /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap(0.75) },
  season: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
  streak: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.up,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  stock: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  ticker: { fontSize: 14, fontWeight: '500', color: theme.colors.textSecondary },
  rankRow: { marginTop: theme.gap(0.5) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  rank: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  asset: { fontSize: 17, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1), marginTop: theme.gap(1) },
  nav: {
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.background,
    paddingVertical: theme.gap(0.75),
    paddingHorizontal: theme.gap(1.5),
  },
  pressed: { opacity: 0.7 },
  navLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
}));
```

- [ ] **Step 2:** `mobile/src/features/game/components/coach-banner.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { Coach } from '../types';

/** 오늘의 코치 한 줄 요약. 본문(content_md)이 있으면 탭해서 제목·본문을 텍스트로 펼친다(마크다운 렌더 없음) */
export function CoachBanner({ coach }: { coach: Coach | null }) {
  const [open, setOpen] = useState(false);
  if (!coach) return null;
  const expandable = coach.content_md !== null && coach.content_md !== '';

  return (
    <View style={styles.box}>
      <Pressable
        onPress={() => {
          if (expandable) setOpen((o) => !o);
        }}
        disabled={!expandable}
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={styles.row}>
        <Text style={styles.icon}>{coach.coach_type === 'EVENING' ? '🌙' : '🌅'}</Text>
        <Text style={styles.summary}>
          <Text style={styles.bold}>오늘의 코치</Text> “{coach.summary_nudge}”
        </Text>
        {expandable ? <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text> : null}
      </Pressable>
      {open && expandable ? (
        <View style={styles.body}>
          <Text style={styles.title}>{coach.title}</Text>
          <Text style={styles.content}>{coach.content_md}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.primarySoft, borderRadius: theme.radius.card, padding: theme.gap(2) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1) },
  icon: { fontSize: 16 },
  summary: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  bold: { fontWeight: '700' },
  chevron: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 3 },
  body: {
    marginTop: theme.gap(1.5),
    paddingTop: theme.gap(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.gap(0.5),
  },
  title: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  content: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
}));
```

- [ ] **Step 3:** `mobile/src/features/game/components/sentiment-bar.tsx`:

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { Sentiment } from '../types';

/** 유저 베팅 심리(WS 5초 주기). 미수신이면 숨김, 0/0 이면 안내 문구 */
export function SentimentBar({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null;
  const empty = sentiment.long_pct === 0 && sentiment.short_pct === 0;

  return (
    <View style={styles.box}>
      <Text style={styles.caption}>📊 유저 베팅 심리</Text>
      {empty ? (
        <Text style={styles.muted}>아직 포지션이 없어요</Text>
      ) : (
        <>
          <View style={styles.track}>
            <View style={[styles.long, { flex: sentiment.long_pct }]} />
            <View style={[styles.short, { flex: sentiment.short_pct }]} />
          </View>
          <View style={styles.labels}>
            <Text style={styles.longLabel}>🔴 Long {sentiment.long_pct}%</Text>
            <Text style={styles.shortLabel}>🔵 Short {sentiment.short_pct}%</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2), gap: theme.gap(1) },
  caption: { fontSize: 12, fontWeight: '500', color: theme.colors.textSecondary },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  track: {
    flexDirection: 'row',
    height: 10,
    borderRadius: theme.radius.chip,
    overflow: 'hidden',
    backgroundColor: theme.colors.border,
  },
  long: { backgroundColor: theme.colors.up },
  short: { backgroundColor: theme.colors.down },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  longLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  shortLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.down },
}));
```

- [ ] **Step 4:** `mobile/src/features/game/components/position-card.tsx`:

```tsx
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, Card } from '@/ui';

import { formatPrice } from '../lib/format';
import type { Position } from '../types';

type Props = {
  position: Position;
  lastPrice: number | null;
  closing: boolean;
  onClose: () => void;
};

/** 보유 포지션 — 평가손익(₩, %)은 WS position_pnl 로 틱마다 갱신. 원클릭 전액 청산 */
export function PositionCard({ position, lastPrice, closing, onClose }: Props) {
  const long = position.side === 'LONG';
  return (
    <Card>
      <View style={styles.row}>
        <Text style={styles.side}>
          <Text style={long ? styles.long : styles.short}>{position.side}</Text> x{position.leverage}배
        </Text>
        <View style={styles.pnl}>
          {position.pnl_amount !== null ? (
            <AmountText value={position.pnl_amount} kind="won" signed size={17} />
          ) : (
            <Text style={styles.dash}>—</Text>
          )}
          {position.roi_pct !== null ? (
            <AmountText value={position.roi_pct} kind="pct" size={14} weight="600" />
          ) : null}
        </View>
      </View>
      <Text style={styles.muted}>
        진입가 {formatPrice(position.entry_price)}원
        {lastPrice !== null ? ` (현재가 ${formatPrice(lastPrice)}원)` : ''}
      </Text>
      <View style={styles.action}>
        <Button label="즉시 전액 청산하기" variant="secondary" loading={closing} onPress={onClose} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.gap(1) },
  side: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  long: { color: theme.colors.up },
  short: { color: theme.colors.down },
  pnl: { flexDirection: 'row', alignItems: 'baseline', gap: theme.gap(0.75) },
  dash: { fontSize: 17, fontWeight: '700', color: theme.colors.textSecondary },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  action: { marginTop: theme.gap(1.5) },
}));
```

- [ ] **Step 5:** `mobile/src/features/game/components/order-panel.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Card, Chip } from '@/ui';

import type { Leverage, Ratio, Side } from '../types';

const RATIOS: { value: Ratio; label: string }[] = [
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 1.0, label: '100%' },
];
const LEVERAGES: Leverage[] = [1, 2, 5];

type Props = {
  hasPosition: boolean;
  academyUnlocked: boolean;
  submitting: boolean;
  onOrder: (side: Side, ratio: Ratio, leverage: Leverage) => void;
  onLockedLeverage: () => void;
};

/** 원클릭 주문 — 비중·배율 칩 + BUY(상승=빨강)/SELL(하락=파랑). 5x 는 아카데미 미해금 시 잠금(🔒 → 아카데미) */
export function OrderPanel({ hasPosition, academyUnlocked, submitting, onOrder, onLockedLeverage }: Props) {
  const [ratio, setRatio] = useState<Ratio>(0.25);
  const [leverage, setLeverage] = useState<Leverage>(1);
  const disabled = hasPosition || submitting;

  return (
    <Card>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>비중</Text>
        {RATIOS.map((r) => (
          <Chip key={r.label} label={r.label} selected={ratio === r.value} onPress={() => setRatio(r.value)} />
        ))}
      </View>
      <View style={styles.chipRow}>
        <Text style={styles.caption}>배율</Text>
        {LEVERAGES.map((l) => {
          const locked = l === 5 && !academyUnlocked;
          return (
            <Chip
              key={l}
              label={`${l}x${locked ? ' 🔒' : ''}`}
              selected={leverage === l}
              onPress={() => (locked ? onLockedLeverage() : setLeverage(l))}
            />
          );
        })}
      </View>
      <View style={styles.buttons}>
        <Pressable
          disabled={disabled}
          onPress={() => onOrder('LONG', ratio, leverage)}
          style={({ pressed }) => [styles.order, styles.buy, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.orderLabel}>🔴 BUY</Text>
          <Text style={styles.orderSub}>(상승 베팅)</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => onOrder('SHORT', ratio, leverage)}
          style={({ pressed }) => [styles.order, styles.sell, pressed && styles.pressed, disabled && styles.disabled]}>
          <Text style={styles.orderLabel}>🔵 SELL</Text>
          <Text style={styles.orderSub}>(하락 베팅)</Text>
        </Pressable>
      </View>
      {hasPosition ? <Text style={styles.hint}>보유 포지션을 먼저 청산하세요</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.gap(1), marginBottom: theme.gap(1) },
  caption: { fontSize: 12, color: theme.colors.textSecondary, width: 28 },
  buttons: { flexDirection: 'row', gap: theme.gap(1.5), marginTop: theme.gap(1) },
  order: {
    flex: 1,
    height: 56,
    borderRadius: theme.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buy: { backgroundColor: theme.colors.up },
  sell: { backgroundColor: theme.colors.down },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  orderLabel: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  orderSub: { fontSize: 12, fontWeight: '500', color: '#ffffff' },
  hint: { marginTop: theme.gap(1), fontSize: 12, textAlign: 'center', color: theme.colors.textSecondary },
}));
```

- [ ] **Step 6:** `mobile/src/features/game/components/game-toaster.tsx`:

```tsx
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useTradingGameStore, type GameToast } from '../store';

const TTL_MS = 5_000;

function ToastItem({ toast }: { toast: GameToast }) {
  const dismiss = useTradingGameStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), TTL_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismiss]);

  return (
    <Pressable
      onPress={() => dismiss(toast.id)}
      accessibilityRole="alert"
      accessibilityHint="탭하면 닫혀요"
      style={[styles.toast, toast.kind === 'error' && styles.error]}>
      <Text style={styles.icon}>{toast.icon}</Text>
      <Text style={styles.message}>{toast.message}</Text>
    </Pressable>
  );
}

type Props = {
  /** 안전영역 상단 여백 적용 여부 — 화면 위 오버레이는 true, 시트(이미 상단 여백 있음) 안에서는 false */
  insetTop?: boolean;
};

/**
 * 게임 넛지/오류 토스트 — 상단 오버레이, 각 5초 후 자동 닫힘, 탭하여 닫기.
 * RN Modal 은 별도 창이라 화면 오버레이가 시트 위로 올라오지 못한다 → 시트(Sheet) 안에도 하나 렌더한다.
 */
export function GameToaster({ insetTop = true }: Props) {
  const toasts = useTradingGameStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[styles.stack, { top: (insetTop ? insets.top : 0) + 8 }]}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { position: 'absolute', left: theme.gap(2), right: theme.gap(2), gap: theme.gap(1), zIndex: 50 },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.gap(1.5),
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  error: { borderColor: theme.colors.up },
  icon: { fontSize: 18 },
  message: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
}));
```

- [ ] **Step 7:** `mobile/src/features/game/components/quiz-banner.tsx`:

```tsx
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** 장 마감 후(KST 15:30~24:00)·주말 강조 배너 — 탭하면 야간 차트 퀴즈 시트 */
export function QuizBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.box, pressed && styles.pressed]}>
      <View style={styles.texts}>
        <Text style={styles.title}>🧩 야간 10초 차트 퀴즈 도전!</Text>
        <Text style={styles.sub}>차트만 보고 5일 뒤 방향을 맞혀 보세요</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.card,
    paddingVertical: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
  },
  pressed: { opacity: 0.85 },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  sub: { fontSize: 12, color: theme.colors.textSecondary },
  chevron: { fontSize: 20, color: theme.colors.primary },
}));
```

- [ ] **Step 8: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 9: 커밋**

```bash
git add mobile/src/features/game/components/game-header.tsx mobile/src/features/game/components/coach-banner.tsx mobile/src/features/game/components/sentiment-bar.tsx mobile/src/features/game/components/position-card.tsx mobile/src/features/game/components/order-panel.tsx mobile/src/features/game/components/game-toaster.tsx mobile/src/features/game/components/quiz-banner.tsx
git commit -m "feat(mobile): 게임 코어 컴포넌트 — 헤더(Streak·순위·자본금)·코치 배너·심리 바·포지션 카드·주문 패널·토스트·퀴즈 배너

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 순수 View 캔들 차트 — `candle-chart.tsx`

**Files:** Create `mobile/src/features/game/components/candle-chart.tsx`

`CandleChart` 는 `onLayout` 으로 폭을 재고 `layoutCandles` 결과를 절대 배치만 한다(퀴즈 재사용, `showLabels=false`). `DailyChart` 는 일봉 로드(최근 60개) → 틱마다 `applyTick` 병합 → 지지/저항/진입 가격선. 로드 전 틱은 무시(web 과 동일), 실패 시 "차트 데이터를 불러오지 못했어요".

- [ ] **Step 1: 구현** — `mobile/src/features/game/components/candle-chart.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getDailyCandles } from '../api';
import { applyTick } from '../lib/candles';
import { layoutCandles, priceToY, type Ohlc } from '../lib/chart-layout';
import { formatPrice, kstDateString } from '../lib/format';
import type { Coach, DailyCandle, Position } from '../types';

// 순수 View 캔들 차트(네이티브 차트 의존성 0). 좌표는 lib/chart-layout 의 순수 함수가 계산한다.
// 색: 상승=빨강(theme up)/하락=파랑(theme down). 지지선 보라·저항선 주황은 고정 상수.
const SUPPORT = '#8b5cf6';
const RESIST = '#f59e0b';
const VISIBLE = 60; // 일봉은 최근 60개만 표시
const LABEL_H = 16;

export type PriceLine = { price: number; color: string; label: string; thick?: boolean };

type CandleChartProps = {
  candles: Ohlc[];
  height: number;
  lines?: PriceLine[];
  /** 가격 라벨(범위 최고/최저·가격선 값) 표시. 퀴즈 차트는 false */
  showLabels?: boolean;
};

/** 캔들 + 가격선 렌더러. 폭은 onLayout 으로 측정(측정 전에는 빈 영역) */
export function CandleChart({ candles, height, lines = [], showLabels = true }: CandleChartProps) {
  const { theme } = useUnistyles();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const layout = layoutCandles(candles, width, height, lines.map((l) => l.price));

  return (
    <View style={[styles.plot, { height }]} onLayout={onLayout}>
      {layout !== null
        ? layout.bars.map((b, i) => {
            const color = b.rising ? theme.colors.up : theme.colors.down;
            return (
              <View key={i} pointerEvents="none">
                <View
                  style={[styles.abs, { left: b.wickLeft, top: b.wickTop, width: 1, height: b.wickHeight, backgroundColor: color }]}
                />
                <View
                  style={[
                    styles.abs,
                    { left: b.bodyLeft, top: b.bodyTop, width: b.bodyWidth, height: b.bodyHeight, backgroundColor: color },
                  ]}
                />
              </View>
            );
          })
        : null}
      {layout !== null
        ? lines.map((l) => {
            const y = priceToY(l.price, layout.range, height);
            const thickness = l.thick ? 2 : 1;
            return (
              <View key={`${l.label}-${l.price}`} pointerEvents="none" style={styles.fill}>
                <View style={[styles.line, { top: y - thickness / 2, height: thickness, backgroundColor: l.color }]} />
                {showLabels ? (
                  <Text
                    style={[styles.lineLabel, { top: y < LABEL_H + 2 ? y + 2 : y - LABEL_H - 2, color: l.color }]}
                    numberOfLines={1}>
                    {l.label} {formatPrice(l.price)}
                  </Text>
                ) : null}
              </View>
            );
          })
        : null}
      {layout !== null && showLabels ? (
        <>
          <Text style={[styles.rangeLabel, styles.rangeTop]}>{formatPrice(layout.range.max)}</Text>
          <Text style={[styles.rangeLabel, styles.rangeBottom]}>{formatPrice(layout.range.min)}</Text>
        </>
      ) : null}
    </View>
  );
}

type DailyChartProps = {
  ticker: string;
  lastPrice: number | null;
  coach: Coach | null;
  position: Position | null;
};

/** 일봉(stock_api) + 오늘 캔들 실시간 병합(WS tick) + 지지/저항/진입가 라인 */
export function DailyChart({ ticker, lastPrice, coach, position }: DailyChartProps) {
  const { theme } = useUnistyles();
  const [candles, setCandles] = useState<DailyCandle[] | null>(null);
  const [failed, setFailed] = useState(false);

  // 1) 일봉 로드(종목이 바뀌면 다시)
  useEffect(() => {
    let cancelled = false;
    setCandles(null);
    setFailed(false);
    getDailyCandles(ticker)
      .then((rows) => {
        if (!cancelled) setCandles(rows.slice(-VISIBLE));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // 2) 틱 → 오늘 캔들 병합(로드 전 틱은 무시 — web 과 동일)
  useEffect(() => {
    if (lastPrice === null) return;
    setCandles((prev) => (prev === null ? prev : applyTick(prev, kstDateString(), lastPrice).slice(-VISIBLE)));
  }, [lastPrice]);

  const lines: PriceLine[] = [];
  if (coach?.support_price != null) lines.push({ price: coach.support_price, color: SUPPORT, label: '지지' });
  if (coach?.resistance_price != null) lines.push({ price: coach.resistance_price, color: RESIST, label: '저항' });
  if (position) {
    lines.push({
      price: position.entry_price,
      color: position.side === 'LONG' ? theme.colors.up : theme.colors.down,
      label: '진입',
      thick: true,
    });
  }

  return (
    <View style={styles.frame}>
      {candles !== null ? <CandleChart candles={candles} height={240} lines={lines} /> : null}
      {candles === null && !failed ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.center}>
          <Text style={styles.muted}>차트 데이터를 불러오지 못했어요</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    minHeight: 260,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    paddingVertical: theme.gap(1.25),
    paddingHorizontal: theme.gap(1),
    overflow: 'hidden',
  },
  plot: { width: '100%', position: 'relative' },
  abs: { position: 'absolute' },
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  line: { position: 'absolute', left: 0, right: 0, opacity: 0.9 },
  lineLabel: {
    position: 'absolute',
    right: 4,
    height: LABEL_H,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 4,
  },
  rangeLabel: {
    position: 'absolute',
    left: 4,
    fontSize: 10,
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.background, // 범위 끝에 걸친 가격선 위에서도 읽히게
    paddingHorizontal: 2,
  },
  rangeTop: { top: 0 },
  rangeBottom: { bottom: 0 },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 2: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 3: 커밋**

```bash
git add mobile/src/features/game/components/candle-chart.tsx
git commit -m "feat(mobile): 순수 View 캔들 차트 — 일봉 60개·틱 병합·지지/저항/진입 가격선(네이티브 의존성 없음)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 시트 — 공용 `Sheet` + 랭킹 · 퀘스트 · 아카데미 · 야간 퀴즈

**Files:** Create `mobile/src/features/game/components/{sheet,leaderboard-sheet,quest-sheet,academy-sheet,quiz-sheet}.tsx`

web `LeaderboardModal`·`QuestModal`·`AcademyModal`·`ChartQuizModal` 의 상태 기계·문구·가드(gen·aliveRef·busyRef·200ms 카운트다운·0초 로컬 시간 초과·503 → `markQuizDisabled`+닫기·`NO_QUIZ_AVAILABLE` 재시도 숨김)를 그대로 옮긴다. 라디오는 `Pressable`(accessibilityRole radio), 탭은 `Chip`, 미니 차트는 `CandleChart`.

`Sheet` 핵심: `Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}`(Android 뒤로가기·iOS 쓸어 닫기) → 루트는 **RN `View` + `useSafeAreaInsets()` 패딩**(iOS pageSheet 는 top 0, Android/web 은 insets.top) — `SafeAreaView` 에 Unistyles 스타일을 넘기면 web 에서 배경이 빠진다. 시트 안에 `GameToaster insetTop={false}`.

- [ ] **Step 1:** `mobile/src/features/game/components/sheet.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { GameToaster } from './game-toaster';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * 게임 공용 시트 — RN Modal(slide + iOS pageSheet). Android 뒤로가기·iOS 아래로 쓸어 닫기는 onRequestClose.
 * 호출부가 열 때 마운트·닫을 때 언마운트한다(열 때마다 로컬 state 초기화·데이터 새로 로드 — web 모달과 동일).
 * RN Modal 은 별도 창이라 화면의 토스트가 가려지므로 시트 안에 GameToaster 를 함께 둔다.
 */
export function Sheet({ title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  // iOS pageSheet 는 상태바 아래에서 시작하므로 상단 안전영역 불필요. Android(전체 화면)·web 은 top 포함.
  // 주의: safe-area-context 의 SafeAreaView 같은 서드파티 컴포넌트에 Unistyles 스타일을 넘기면 web 에서 배경이 적용되지 않는다
  //       (Unistyles 는 RN 기본 컴포넌트에만 스타일을 바인딩) → RN View + inset 패딩으로 처리.
  const padTop = Platform.OS === 'ios' ? 0 : insets.top;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: padTop, paddingBottom: insets.bottom }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        <GameToaster insetTop={false} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.border,
    marginTop: theme.gap(1),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(1.5),
    paddingBottom: theme.gap(1),
  },
  title: { fontSize: 20, fontWeight: '700', color: theme.colors.text },
  close: { fontSize: 18, color: theme.colors.textSecondary },
  content: { paddingHorizontal: theme.gap(2.5), paddingBottom: theme.gap(4), gap: theme.gap(1.5) },
}));
```

- [ ] **Step 2:** `mobile/src/features/game/components/leaderboard-sheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, Chip } from '@/ui';

import { getHallOfFame, getLeaderboard } from '../api';
import { gameErrorMessage } from '../lib/errors';
import type { HallOfFameRow, LeaderboardRow } from '../types';
import { Sheet } from './sheet';

type Tab = 'season' | 'hof';
type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

type Props = {
  seasonId: number;
  /** 로그인 유저 id(비로그인 null) — 내 행 강조용 */
  myUserId: number | null;
  onClose: () => void;
};

/** 승률은 0~100 부호 없는 퍼센트(formatPct 는 + 부호를 붙이므로 쓰지 않는다) */
const winRate = (n: number): string => `${n.toFixed(1)}%`;

/** 명예의 전당 행(시즌 desc · 순위 asc 정렬 유지)을 시즌별로 묶는다 */
function groupBySeason(rows: HallOfFameRow[]): { seasonId: number; rows: HallOfFameRow[] }[] {
  const groups: { seasonId: number; rows: HallOfFameRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.seasonId === r.season_id) last.rows.push(r);
    else groups.push({ seasonId: r.season_id, rows: [r] });
  }
  return groups;
}

/** 랭킹 시트 — 시즌 Top 100 / 명예의 전당(MBTI). 공개 API 라 비로그인도 열람. 열릴 때·탭 전환 시 활성 탭만 로드 */
export function LeaderboardSheet({ seasonId, myUserId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('season');
  const [board, setBoard] = useState<Load<LeaderboardRow[]>>({ kind: 'loading' });
  const [hof, setHof] = useState<Load<HallOfFameRow[]>>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (tab === 'season') {
      setBoard({ kind: 'loading' });
      getLeaderboard(seasonId)
        .then((data) => {
          if (!cancelled) setBoard({ kind: 'ok', data });
        })
        .catch((err: unknown) => {
          if (!cancelled) setBoard({ kind: 'error', message: gameErrorMessage(err) });
        });
    } else {
      setHof({ kind: 'loading' });
      getHallOfFame()
        .then((data) => {
          if (!cancelled) setHof({ kind: 'ok', data });
        })
        .catch((err: unknown) => {
          if (!cancelled) setHof({ kind: 'error', message: gameErrorMessage(err) });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tab, seasonId, reloadKey]);

  const current = tab === 'season' ? board : hof;

  return (
    <Sheet title="🏆 랭킹" onClose={onClose}>
      <View style={styles.tabs}>
        <Chip label="시즌 랭킹" selected={tab === 'season'} onPress={() => setTab('season')} />
        <Chip label="명예의 전당" selected={tab === 'hof'} onPress={() => setTab('hof')} />
      </View>

      {current.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
        </View>
      ) : null}
      {current.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.muted}>{current.message}</Text>
          <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
        </View>
      ) : null}

      {tab === 'season' && board.kind === 'ok' ? (
        board.data.length === 0 ? (
          <Text style={[styles.muted, styles.empty]}>아직 순위가 없어요</Text>
        ) : (
          <View>
            {board.data.map((r) => {
              const mine = myUserId !== null && r.user_id === myUserId;
              return (
                <View key={r.user_id} style={[styles.row, mine && styles.mine]}>
                  <Text style={styles.rank}>{r.rank}</Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.nickname ?? '익명'}
                    {mine ? <Text style={styles.me}> 나</Text> : null}
                  </Text>
                  <AmountText value={r.roi_pct} kind="pct" size={14} weight="600" />
                  <Text style={styles.win}>승률 {winRate(r.win_rate)}</Text>
                </View>
              );
            })}
          </View>
        )
      ) : null}

      {tab === 'hof' && hof.kind === 'ok' ? (
        hof.data.length === 0 ? (
          <Text style={[styles.muted, styles.empty]}>아직 명예의 전당이 비어 있어요</Text>
        ) : (
          <View style={styles.groups}>
            {groupBySeason(hof.data).map((g) => (
              <View key={g.seasonId}>
                {/* API 가 시즌 번호 없이 season_id 만 준다 — id 를 시즌 표기로 사용 */}
                <Text style={styles.groupTitle}>시즌 {g.seasonId}</Text>
                {g.rows.map((r) => (
                  <View key={r.rank} style={styles.row}>
                    <Text style={styles.rank}>{r.rank}</Text>
                    <View style={styles.nameBox}>
                      <Text style={styles.nameText} numberOfLines={1}>
                        {r.nickname}
                      </Text>
                      {r.trading_mbti ? (
                        <Text style={styles.mbti} numberOfLines={1}>
                          {r.trading_mbti}
                        </Text>
                      ) : null}
                    </View>
                    <AmountText value={r.final_roi} kind="pct" size={14} weight="600" />
                    <Text style={styles.win}>승률 {winRate(r.win_rate)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  tabs: { flexDirection: 'row', gap: theme.gap(1) },
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  empty: { paddingVertical: theme.gap(5) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: theme.radius.input,
  },
  mine: { backgroundColor: theme.colors.primarySoft },
  rank: { width: 28, fontSize: 14, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  name: { flex: 1, fontSize: 14, color: theme.colors.text },
  me: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },
  nameBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75), minWidth: 0 },
  nameText: { flexShrink: 1, fontSize: 14, color: theme.colors.text },
  mbti: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '500',
    color: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1),
    paddingVertical: 2,
    overflow: 'hidden',
  },
  win: { width: 76, textAlign: 'right', fontSize: 12, color: theme.colors.textSecondary },
  groups: { gap: theme.gap(2.5) },
  groupTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.text, marginBottom: theme.gap(0.5) },
}));
```

- [ ] **Step 3:** `mobile/src/features/game/components/quest-sheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card, formatWon } from '@/ui';

import { claimQuest, getQuests } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { Quest, QuestList } from '../types';
import { Sheet } from './sheet';

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

function rewardLabel(q: Quest): string {
  if (q.reward_cash !== null) return `+${formatWon(q.reward_cash)}`;
  if (q.reward_badge !== null) return '🏅 뱃지';
  return '';
}

type QuestCardProps = {
  quest: Quest;
  claiming: boolean;
  onClaim: () => void;
};

function QuestCard({ quest, claiming, onClaim }: QuestCardProps) {
  const done = Math.min(quest.progress, quest.target);
  const pct = quest.target > 0 ? (done / quest.target) * 100 : 0;
  return (
    <Card>
      <View style={styles.head}>
        <View style={styles.texts}>
          <Text style={styles.title}>{quest.title}</Text>
          <Text style={styles.desc}>{quest.description}</Text>
        </View>
        <Text style={styles.reward}>{rewardLabel(quest)}</Text>
      </View>
      <View style={styles.progressRow}>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: quest.target, now: done }}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.count}>
          {done}/{quest.target}
        </Text>
      </View>
      <View style={styles.action}>
        {quest.claimed ? (
          <Button label="받음 ✓" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        ) : quest.completed ? (
          <Button label="보상 받기" loading={claiming} fullWidth={false} onPress={onClaim} />
        ) : (
          <Button label="진행 중" variant="secondary" disabled fullWidth={false} onPress={() => {}} />
        )}
      </View>
    </Card>
  );
}

/** 퀘스트 시트 — Q1~Q3 진행률·보상 수령·보유 뱃지. 로그인 전용(게임 화면이 비로그인 시 내정보 탭으로 보낸다) */
export function QuestSheet({ onClose }: { onClose: () => void }) {
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [state, setState] = useState<Load<QuestList>>({ kind: 'loading' });
  const [claiming, setClaiming] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    getQuests()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const claim = async (code: string) => {
    if (claiming !== null) return;
    const gen = currentPrivateGen();
    setClaiming(code);
    try {
      const res = await claimQuest(code);
      setState((s) => {
        if (s.kind !== 'ok') return s;
        const quests = s.data.quests.map((q) => (q.code === res.quest.code ? res.quest : q));
        const badge = res.badge;
        const badges =
          badge && !s.data.badges.some((b) => b.code === badge.code) ? [...s.data.badges, badge] : s.data.badges;
        return { kind: 'ok', data: { quests, badges } };
      });
      if (gen === currentPrivateGen()) {
        void refreshTrading(); // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' });
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) });
    } finally {
      setClaiming(null);
    }
  };

  return (
    <Sheet title="🎯 퀘스트" onClose={onClose}>
      {state.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.muted}>{state.message}</Text>
          <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
        </View>
      ) : null}
      {state.kind === 'ok' ? (
        <>
          {state.data.quests.map((q) => (
            <QuestCard key={q.code} quest={q} claiming={claiming === q.code} onClaim={() => void claim(q.code)} />
          ))}
          {state.data.badges.length > 0 ? (
            <View style={styles.badges}>
              <Text style={styles.badgeTitle}>보유 뱃지</Text>
              <View style={styles.badgeRow}>
                {state.data.badges.map((b) => (
                  <Text key={b.code} style={styles.badge}>
                    🏅 {b.name}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap(1.5) },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  desc: { fontSize: 13, color: theme.colors.textSecondary },
  reward: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(1.5), marginTop: theme.gap(1) },
  track: {
    flex: 1,
    height: 8,
    borderRadius: theme.radius.chip,
    backgroundColor: theme.colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: theme.radius.chip, backgroundColor: theme.colors.primary },
  count: { width: 40, textAlign: 'right', fontSize: 12, color: theme.colors.textSecondary, fontVariant: ['tabular-nums'] },
  action: { marginTop: theme.gap(1), alignItems: 'flex-end' },
  badges: { gap: theme.gap(1), paddingTop: theme.gap(1) },
  badgeTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap(1) },
  badge: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.gap(1.5),
    paddingVertical: theme.gap(0.75),
    overflow: 'hidden',
  },
}));
```

- [ ] **Step 4:** `mobile/src/features/game/components/academy-sheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Button, Card } from '@/ui';

import { getAcademyQuiz, submitAcademy } from '../api';
import { gameErrorMessage } from '../lib/errors';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { AcademyQuiz, AcademySubmitResult } from '../types';
import { Sheet } from './sheet';

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

/** 아카데미 시트 — 리스크 관리 3문항. 모두 맞히면 5배 레버리지 해금(재응시 무제한). 로그인 전용 */
export function AcademySheet({ onClose }: { onClose: () => void }) {
  const setAcademyUnlocked = useTradingGameStore((s) => s.setAcademyUnlocked);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [state, setState] = useState<Load<AcademyQuiz>>({ kind: 'loading' });
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<AcademySubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const gen = currentPrivateGen();
    setState({ kind: 'loading' });
    getAcademyQuiz()
      .then((data) => {
        if (cancelled) return;
        setState({ kind: 'ok', data });
        if (data.unlocked) setAcademyUnlocked(true, gen); // 다른 기기에서 해금한 경우 동기화
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, setAcademyUnlocked]);

  const submit = async () => {
    if (submitting) return;
    const gen = currentPrivateGen();
    setSubmitting(true);
    try {
      const res = await submitAcademy(answers);
      setResult(res);
      if (res.unlocked) {
        setAcademyUnlocked(true, gen);
        pushToast({ kind: 'info', icon: '🔓', message: '5배 레버리지가 해금됐어요' });
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setAnswers({});
    setResult(null);
  };

  return (
    <Sheet title="🎓 아카데미" onClose={onClose}>
      {state.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.muted}>{state.message}</Text>
          <Button label="다시 시도" variant="secondary" fullWidth={false} onPress={() => setReloadKey((k) => k + 1)} />
        </View>
      ) : null}
      {state.kind === 'ok' && state.data.unlocked && result === null ? (
        <Text style={styles.unlockedBig}>🔓 5배 레버리지가 해금됐어요</Text>
      ) : null}
      {state.kind === 'ok' && (!state.data.unlocked || result !== null) ? (
        <>
          <Text style={styles.muted}>세 문제를 모두 맞히면 5배 레버리지가 열려요.</Text>
          {state.data.questions.map((q, qi) => {
            const r = result?.results.find((x) => x.id === q.id) ?? null;
            const locked = result !== null || submitting;
            return (
              <Card key={q.id}>
                <Text style={styles.question}>
                  {qi + 1}. {q.question}
                  {r ? ` ${r.correct ? '✅' : '❌'}` : ''}
                </Text>
                <View style={styles.choices} accessibilityRole="radiogroup">
                  {q.choices.map((c, ci) => {
                    const selected = answers[q.id] === ci;
                    return (
                      <Pressable
                        key={ci}
                        disabled={locked}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected, disabled: locked }}
                        onPress={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                        style={[styles.choice, selected && styles.choiceOn]}>
                        <View style={[styles.radio, selected && styles.radioOn]} />
                        <Text style={styles.choiceText}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {r ? (
                  <View style={styles.explain}>
                    <Text style={styles.answer}>정답: {q.choices[r.answer] ?? '—'}</Text>
                    <Text style={styles.muted}>{r.explanation}</Text>
                  </View>
                ) : null}
              </Card>
            );
          })}
          {result === null ? (
            <Button
              label="제출"
              disabled={state.data.questions.some((q) => answers[q.id] === undefined)}
              loading={submitting}
              onPress={() => void submit()}
            />
          ) : result.unlocked ? (
            <Text style={styles.unlocked}>🔓 5배 레버리지가 해금됐어요</Text>
          ) : (
            <Button label="다시 도전" variant="secondary" onPress={retry} />
          )}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  state: { paddingVertical: theme.gap(5), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  unlockedBig: {
    paddingVertical: theme.gap(5),
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  unlocked: { textAlign: 'center', fontSize: 16, fontWeight: '700', color: theme.colors.primary },
  question: { fontSize: 15, fontWeight: '600', color: theme.colors.text, lineHeight: 22 },
  choices: { gap: theme.gap(0.75), marginTop: theme.gap(1) },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.gap(1),
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.background,
  },
  choiceOn: { backgroundColor: theme.colors.primarySoft },
  radio: {
    width: 18,
    height: 18,
    marginTop: 1,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.colors.border,
  },
  radioOn: { borderColor: theme.colors.primary, borderWidth: 6 },
  choiceText: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  explain: {
    marginTop: theme.gap(1),
    padding: theme.gap(1.5),
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.background,
    gap: theme.gap(0.5),
  },
  answer: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
}));
```

- [ ] **Step 5:** `mobile/src/features/game/components/quiz-sheet.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AmountText, Button, formatWon } from '@/ui';

import { getRandomQuiz, submitQuiz } from '../api';
import { apiErrorCode, gameErrorMessage } from '../lib/errors';
import { quizSecondsLeft } from '../lib/quiz';
import { currentPrivateGen, useTradingGameStore } from '../store';
import type { QuizChoice, QuizQuestion, QuizResult } from '../types';
import { CandleChart } from './candle-chart';
import { Sheet } from './sheet';

const TICK_MS = 200;

// result === null → 0초까지 고르지 않아 제출하지 않은 로컬 시간 초과(정답 미공개)
type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'playing'; quiz: QuizQuestion; startedAt: number }
  | { kind: 'submitting'; quiz: QuizQuestion; choice: QuizChoice }
  | { kind: 'result'; result: QuizResult | null; choice: QuizChoice | null }
  | { kind: 'error'; message: string; retryable: boolean };

const choiceLabel = (c: QuizChoice): string => (c === 'UP' ? '📈 상승' : '📉 하락');

function rewardLine(r: QuizResult): string | null {
  if (r.rewarded) return `+${formatWon(r.reward_cash)} 지급`;
  if (r.timed_out) return '시간 초과로 보상 없음';
  if (r.correct) return '정답이에요! 이번에는 보상이 지급되지 않았어요 (하루 3회 한도 또는 보상 지급 불가)';
  return null;
}

/**
 * 야간 10초 차트 퀴즈 — intro → loading → playing → submitting → result (오류 시 error). (web ChartQuizModal 과 동일 규칙)
 * 판정은 서버 시각 기준(10초 + 유예 3초). 카운트다운은 연출이며 0초가 되면 제출하지 않고 로컬 시간 초과 처리.
 */
export function QuizSheet({ onClose }: { onClose: () => void }) {
  const markQuizDisabled = useTradingGameStore((s) => s.markQuizDisabled);
  const setStreak = useTradingGameStore((s) => s.setStreak);
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading);
  const pushToast = useTradingGameStore((s) => s.pushToast);
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [now, setNow] = useState(() => Date.now());
  const aliveRef = useRef(true); // 언마운트 후 늦은 응답이 화면 전환·onClose 를 부르지 않도록
  const busyRef = useRef(false); // 시작/제출 중복 탭 방지(리렌더 전 연타 대비)

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 카운트다운 — playing 동안만 200ms 간격 갱신. 단계가 바뀌거나 언마운트되면 정리
  const playing = phase.kind === 'playing';
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [playing]);

  const secondsLeft = phase.kind === 'playing' ? quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, now) : 0;

  // 0초 도달(미선택) → 서버에 제출하지 않고 로컬 시간 초과. playing 에서만 전환(submitting 중엔 무시)
  useEffect(() => {
    if (phase.kind === 'playing' && secondsLeft === 0) setPhase({ kind: 'result', result: null, choice: null });
  }, [phase, secondsLeft]);

  const handleError = (err: unknown) => {
    const code = apiErrorCode(err);
    if (code === 'FEATURE_DISABLED') {
      markQuizDisabled();
      pushToast({ kind: 'info', icon: '🧩', message: gameErrorMessage(err) });
      if (aliveRef.current) onClose();
      return;
    }
    if (aliveRef.current) {
      setPhase({ kind: 'error', message: gameErrorMessage(err), retryable: code !== 'NO_QUIZ_AVAILABLE' });
    }
  };

  const start = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase({ kind: 'loading' });
    try {
      const quiz = await getRandomQuiz();
      if (!aliveRef.current) return;
      const t = Date.now(); // 응답 도착 시점부터 카운트(서버 served_at 보다 늦게 시작 — 유예 3초가 흡수)
      setNow(t);
      setPhase({ kind: 'playing', quiz, startedAt: t });
    } catch (err) {
      handleError(err);
    } finally {
      busyRef.current = false;
    }
  };

  const choose = async (choice: QuizChoice) => {
    if (phase.kind !== 'playing' || busyRef.current) return;
    if (quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, Date.now()) === 0) return;
    busyRef.current = true;
    const quiz = phase.quiz;
    const gen = currentPrivateGen();
    setPhase({ kind: 'submitting', quiz, choice });
    try {
      const result = await submitQuiz(quiz.id, choice);
      if (result.streak) setStreak(result.streak, gen);
      if (result.rewarded && gen === currentPrivateGen()) void refreshTrading(); // 보상 → 헤더 자본금 반영
      if (aliveRef.current) setPhase({ kind: 'result', result, choice });
    } catch (err) {
      handleError(err);
    } finally {
      busyRef.current = false;
    }
  };

  const footer = (
    <View style={styles.footer}>
      <View style={styles.flex}>
        <Button label="다음 문제" onPress={() => void start()} />
      </View>
      <View style={styles.flex}>
        <Button label="닫기" variant="secondary" onPress={onClose} />
      </View>
    </View>
  );

  return (
    <Sheet title="🧩 야간 10초 차트 퀴즈" onClose={onClose}>
      {phase.kind === 'intro' ? (
        <>
          <View style={styles.rules}>
            <Text style={styles.rule}>📊 날짜·종목을 가린 차트를 보고 5거래일 뒤 주가 방향을 맞혀요.</Text>
            <Text style={styles.rule}>⏱ 제한 시간은 10초. 시간 안에 고르지 않으면 제출되지 않아요.</Text>
            <Text style={styles.rule}>🎁 정답이면 +₩200,000 (보상은 하루 3회까지).</Text>
          </View>
          <Button label="시작" onPress={() => void start()} />
        </>
      ) : null}

      {phase.kind === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator />
          <Text style={styles.muted}>문제를 불러오는 중…</Text>
        </View>
      ) : null}

      {phase.kind === 'playing' || phase.kind === 'submitting' ? (
        <>
          <View style={styles.playHead}>
            <Text style={styles.ask}>5거래일 뒤 주가는?</Text>
            {phase.kind === 'playing' ? (
              <Text
                style={[styles.timer, secondsLeft <= 3 && styles.timerUrgent]}
                accessibilityLiveRegion="polite">
                ⏱ {secondsLeft}초
              </Text>
            ) : (
              <Text style={styles.muted}>채점 중…</Text>
            )}
          </View>
          <View style={styles.chartFrame}>
            <CandleChart candles={phase.quiz.chart_snapshot} height={200} showLabels={false} />
          </View>
          <View style={styles.footer}>
            <Pressable
              disabled={phase.kind !== 'playing'}
              onPress={() => void choose('UP')}
              style={[styles.pick, styles.up, phase.kind !== 'playing' && styles.disabled]}>
              <Text style={styles.pickLabel}>오를까? 📈</Text>
            </Pressable>
            <Pressable
              disabled={phase.kind !== 'playing'}
              onPress={() => void choose('DOWN')}
              style={[styles.pick, styles.down, phase.kind !== 'playing' && styles.disabled]}>
              <Text style={styles.pickLabel}>내릴까? 📉</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {phase.kind === 'result' && phase.result === null ? (
        <>
          <Text style={styles.headline}>⏰ 시간 초과</Text>
          <Text style={[styles.muted, styles.center]}>선택하지 않아 제출되지 않았어요. 정답은 공개되지 않아요.</Text>
          {footer}
        </>
      ) : null}

      {phase.kind === 'result' && phase.result !== null ? (
        <>
          <Text style={[styles.headline, phase.result.correct && styles.correct]}>
            {phase.result.correct ? '⭕ 정답이에요!' : phase.result.timed_out ? '⏰ 시간 초과' : '❌ 아쉽게 틀렸어요'}
          </Text>
          <View style={styles.lines}>
            <Text style={styles.line}>
              정답 {choiceLabel(phase.result.answer)}
              {phase.choice !== null ? <Text style={styles.muted}> · 내 선택 {choiceLabel(phase.choice)}</Text> : null}
            </Text>
            <View style={styles.inline}>
              <Text style={styles.line}>실제 5일 등락</Text>
              <AmountText value={phase.result.actual_change} kind="pct" size={14} weight="600" />
            </View>
            <Text style={styles.line}>패턴 {phase.result.pattern_type}</Text>
            {rewardLine(phase.result) !== null ? (
              <Text style={phase.result.rewarded ? styles.rewarded : styles.muted}>{rewardLine(phase.result)}</Text>
            ) : null}
          </View>
          <Text style={styles.explain}>{phase.result.explanation}</Text>
          <Text style={styles.meta}>
            종목 {phase.result.ticker} · 기준일 {phase.result.base_date}
          </Text>
          {footer}
        </>
      ) : null}

      {phase.kind === 'error' ? (
        <View style={styles.state}>
          <Text style={styles.line}>{phase.message}</Text>
          <View style={styles.footer}>
            {phase.retryable ? (
              <View style={styles.flex}>
                <Button label="다시 시도" onPress={() => void start()} />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button label="닫기" variant="secondary" onPress={onClose} />
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  rules: { gap: theme.gap(1), marginBottom: theme.gap(1) },
  rule: { fontSize: 14, lineHeight: 21, color: theme.colors.text },
  state: { paddingVertical: theme.gap(4), alignItems: 'center', gap: theme.gap(1.5) },
  muted: { fontSize: 14, color: theme.colors.textSecondary },
  center: { textAlign: 'center' },
  playHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ask: { fontSize: 16, fontWeight: '600', color: theme.colors.text },
  timer: { fontSize: 18, fontWeight: '700', color: theme.colors.text, fontVariant: ['tabular-nums'] },
  timerUrgent: { color: theme.colors.up },
  chartFrame: {
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.gap(1),
    overflow: 'hidden',
  },
  footer: { flexDirection: 'row', gap: theme.gap(1.5), alignSelf: 'stretch' },
  pick: { flex: 1, height: 56, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  up: { backgroundColor: theme.colors.up },
  down: { backgroundColor: theme.colors.down },
  disabled: { opacity: 0.4 },
  pickLabel: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  headline: {
    paddingVertical: theme.gap(1.5),
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  correct: { color: theme.colors.up },
  lines: { gap: theme.gap(0.75) },
  line: { fontSize: 14, color: theme.colors.text },
  inline: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(0.75) },
  rewarded: { fontSize: 14, fontWeight: '600', color: theme.colors.up },
  explain: {
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.input,
    padding: theme.gap(1.5),
    overflow: 'hidden',
  },
  meta: { fontSize: 12, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 6: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 7: 커밋**

```bash
git add mobile/src/features/game/components/sheet.tsx mobile/src/features/game/components/leaderboard-sheet.tsx mobile/src/features/game/components/quest-sheet.tsx mobile/src/features/game/components/academy-sheet.tsx mobile/src/features/game/components/quiz-sheet.tsx
git commit -m "feat(mobile): 게임 시트 — 공용 RN Modal 시트·랭킹/명예의 전당·퀘스트·아카데미(5x 해금)·야간 10초 차트 퀴즈

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 9: 게임 화면 조립 — `app/(tabs)/game.tsx` 교체

**Files:** Modify(전체 교체) `mobile/src/app/(tabs)/game.tsx`

web `GamePage` 와 같은 상태 분기·effect(시즌 로드, 로그인 변화 → loadPrivate/resetPrivate, 로그아웃 시 로그인 전용 시트 닫기, 순위 30초 폴링, 퀴즈 배너 1분 재판정, WS). 차이: 비로그인 진입 → 토스트 + 내정보 탭, `RefreshControl`(시즌 + 로그인 시 개인 데이터), 화면 토스터는 시트가 없을 때만. 스토어는 필드별 셀렉터로 구독.

- [ ] **Step 1: 교체** — `mobile/src/app/(tabs)/game.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { useAuthStore } from '@/features/auth/store';
import { AcademySheet } from '@/features/game/components/academy-sheet';
import { DailyChart } from '@/features/game/components/candle-chart';
import { CoachBanner } from '@/features/game/components/coach-banner';
import { GameHeader } from '@/features/game/components/game-header';
import { GameToaster } from '@/features/game/components/game-toaster';
import { LeaderboardSheet } from '@/features/game/components/leaderboard-sheet';
import { OrderPanel } from '@/features/game/components/order-panel';
import { PositionCard } from '@/features/game/components/position-card';
import { QuestSheet } from '@/features/game/components/quest-sheet';
import { QuizBanner } from '@/features/game/components/quiz-banner';
import { QuizSheet } from '@/features/game/components/quiz-sheet';
import { SentimentBar } from '@/features/game/components/sentiment-bar';
import { isQuizPrimeTime } from '@/features/game/lib/quiz';
import { useTradingGameStore } from '@/features/game/store';
import type { Leverage, Ratio, Side } from '@/features/game/types';
import { useGameSocket } from '@/features/game/use-game-socket';
import { ListState } from '@/ui';

const RANK_POLL_MS = 30_000;
const PRIME_CHECK_MS = 60_000;

type ActiveModal = 'ranking' | 'quest' | 'academy' | 'quiz' | null;
type PrivateModal = Exclude<ActiveModal, 'ranking' | null>;

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면.
// 시트(RN Modal)는 한 번에 하나(activeModal). 랭킹은 공개, 퀘스트·아카데미·퀴즈·주문은 로그인 필요(내정보 탭으로 이동).
export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const loggedIn = token !== null;

  const status = useTradingGameStore((s) => s.status);
  const season = useTradingGameStore((s) => s.season);
  const account = useTradingGameStore((s) => s.account);
  const position = useTradingGameStore((s) => s.position);
  const myRank = useTradingGameStore((s) => s.myRank);
  const coach = useTradingGameStore((s) => s.coach);
  const academyUnlocked = useTradingGameStore((s) => s.academyUnlocked);
  const streak = useTradingGameStore((s) => s.streak);
  const quizDisabled = useTradingGameStore((s) => s.quizDisabled);
  const lastPrice = useTradingGameStore((s) => s.lastPrice);
  const sentiment = useTradingGameStore((s) => s.sentiment);
  const submitting = useTradingGameStore((s) => s.submitting);
  const closing = useTradingGameStore((s) => s.closing);
  const loadSeason = useTradingGameStore((s) => s.loadSeason);
  const loadPrivate = useTradingGameStore((s) => s.loadPrivate);
  const resetPrivate = useTradingGameStore((s) => s.resetPrivate);
  const refreshRank = useTradingGameStore((s) => s.refreshRank);
  const placeOrder = useTradingGameStore((s) => s.placeOrder);
  const closePosition = useTradingGameStore((s) => s.closePosition);
  const pushToast = useTradingGameStore((s) => s.pushToast);

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()));
  const [refreshing, setRefreshing] = useState(false);
  const ready = status === 'ready';

  useEffect(() => {
    void loadSeason();
  }, [loadSeason]);

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return;
    if (loggedIn) void loadPrivate();
    else resetPrivate();
  }, [ready, loggedIn, loadPrivate, resetPrivate]);

  // 로그아웃 시 로그인 전용 시트 닫기(랭킹은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' ? m : null));
  }, [loggedIn]);

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신
  useEffect(() => {
    if (!ready || !loggedIn) return;
    const t = setInterval(() => void refreshRank(), RANK_POLL_MS);
    return () => clearInterval(t);
  }, [ready, loggedIn, refreshRank]);

  // 장 마감 후/주말 퀴즈 배너 — 1분마다 재판정(화면을 켜 둔 채 15:30 을 넘기는 경우)
  useEffect(() => {
    const t = setInterval(() => setPrimeTime(isQuizPrimeTime(new Date())), PRIME_CHECK_MS);
    return () => clearInterval(t);
  }, []);

  useGameSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
  );

  const header = <Text style={styles.screenTitle}>트레이딩 게임</Text>;

  if (status === 'unavailable' || status === 'no-season') {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        {header}
        <ListState
          mode="empty"
          emoji="🎮"
          title="시즌을 준비하고 있어요"
          hint="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
        />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        {header}
        <ListState
          mode="error"
          title="게임 서버에 연결할 수 없어요"
          hint="잠시 후 다시 시도해 주세요."
          onRetry={() => void loadSeason()}
        />
      </View>
    );
  }
  if (!ready || !season) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        {header}
        <ListState mode="loading" />
      </View>
    );
  }

  /** 비로그인 — 토스트로 안내하고 내정보 탭(게스트 로그인)으로 보낸다 */
  const requireLogin = () => {
    pushToast({ kind: 'info', icon: '🔑', message: '내정보 탭에서 로그인하고 시즌에 참여하세요' });
    router.push('/(tabs)/profile');
  };

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage) => {
    if (!loggedIn) {
      requireLogin();
      return;
    }
    void placeOrder(side, ratio, leverage);
  };

  const openPrivate = (m: PrivateModal) => {
    if (!loggedIn) {
      requireLogin();
      return;
    }
    setActiveModal(m);
  };
  const closeModal = () => setActiveModal(null);

  // 당겨서 새로고침 — 시즌 + (로그인 시) 개인 데이터 재조회
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadSeason();
      if (loggedIn) await loadPrivate();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
        <Text style={[styles.screenTitle, styles.titleInScroll]}>트레이딩 게임</Text>
        <GameHeader
          season={season}
          account={account}
          myRank={myRank}
          loggedIn={loggedIn}
          streak={streak}
          showQuiz={!quizDisabled}
          onOpenRanking={() => setActiveModal('ranking')}
          onOpenQuest={() => openPrivate('quest')}
          onOpenQuiz={() => openPrivate('quiz')}
        />
        <CoachBanner coach={coach} />
        {loggedIn ? (
          <SentimentBar sentiment={sentiment} />
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>로그인하면 실시간 시세와 주문이 열려요</Text>
          </View>
        )}
        <DailyChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
        {position ? (
          <PositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => void closePosition()} />
        ) : null}
        {primeTime && !quizDisabled ? <QuizBanner onOpen={() => openPrivate('quiz')} /> : null}
        <OrderPanel
          hasPosition={position !== null}
          academyUnlocked={academyUnlocked}
          submitting={submitting}
          onOrder={handleOrder}
          onLockedLeverage={() => openPrivate('academy')}
        />
      </ScrollView>

      {/* 시트가 열려 있으면 토스트는 시트 안(Sheet → GameToaster)에서 보인다 — 화면 오버레이는 시트에 가려지므로 숨김 */}
      {activeModal === null ? <GameToaster /> : null}
      {activeModal === 'ranking' ? <LeaderboardSheet seasonId={season.id} myUserId={userId} onClose={closeModal} /> : null}
      {activeModal === 'quest' ? <QuestSheet onClose={closeModal} /> : null}
      {activeModal === 'academy' ? <AcademySheet onClose={closeModal} /> : null}
      {activeModal === 'quiz' ? <QuizSheet onClose={closeModal} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  content: { paddingHorizontal: theme.gap(2), paddingBottom: theme.gap(4), gap: theme.gap(1.5) },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(2),
  },
  titleInScroll: { paddingHorizontal: theme.gap(0.5), paddingTop: theme.gap(1), paddingBottom: theme.gap(0.5) },
  notice: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: theme.gap(2) },
  noticeText: { fontSize: 14, color: theme.colors.textSecondary },
}));
```

- [ ] **Step 2: 공통 검증**

```bash
cd mobile
npx tsc --noEmit
npm test
```
기대: tsc 출력 없음, jest 전 스위트 PASS(기존 `src/ui/format.test.ts` 포함).

- [ ] **Step 3: 웹 렌더 확인(빠른 점검)** — `cd mobile && npx expo start --web --port 8082` 후 `curl -s http://localhost:8082/game | grep -c '트레이딩 게임'` → 1 이상(SSR 셸이 로딩 상태로 렌더). 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add mobile/src/app/(tabs)/game.tsx
git commit -m "feat(mobile): 게임 탭 — 실시간 트레이딩 화면 조립(상태 분기·당겨서 새로고침·시트 4종·비로그인 → 내정보)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 10: 문서 + 스모크 (컨트롤러 수행)

**Files:** Modify `mobile/.env.example`, `README.md`(모바일 섹션·환경변수 표), `docs/ROADMAP.md`(6c). 로컬 전용: `mobile/.env.development`(gitignore — 커밋 안 함)

- [ ] **Step 1: `mobile/.env.example`** — 주석 블록의 `[운영]` 목록 끝(`EXPO_PUBLIC_AUTH_API_URL=https://auth.haezean.com` 줄 다음)에 한 줄:

```
#       EXPO_PUBLIC_GAME_API_URL=(trading_game 운영 배포 후 지정 — 미설정이면 게임 탭 "준비 중")
```

파일 **끝**에 추가:

```
# 트레이딩 게임(trading_game :8003) REST·WS — 선택. dev 미설정 시 http://localhost:8003
EXPO_PUBLIC_GAME_API_URL=http://localhost:8003
```

로컬 `mobile/.env.development` 끝에도 `EXPO_PUBLIC_GAME_API_URL=http://localhost:8003` 추가(스펙 §6, 비밀값 아님 — gitignore 라 커밋되지 않음).

- [ ] **Step 2: README** — `### 5. 모바일 앱 (Expo / React Native)` 섹션의 `- **게스트 로그인**: ...` 줄 다음에 추가:

```markdown
- **게임 탭(트레이딩 게임 6c)**: web 6a+6b 와 동일 기능(헤더·Streak·코치 배너·심리 바·일봉+실시간 차트·포지션/주문·넛지 토스트 + 🏆 랭킹·🎯 퀘스트·🎓 아카데미(5x 해금)·🧩 야간 10초 차트 퀴즈 시트). trading_game(8003)·stock_api(8002, 일봉)·auth(8001) 필요. `EXPO_PUBLIC_GAME_API_URL`은 **선택** — 미설정 시 dev 는 `http://localhost:8003`, production 이면 "시즌을 준비하고 있어요". 차트는 신규 네이티브 의존성 없는 순수 View 렌더(`src/features/game/lib/chart-layout.ts`). 로그인은 내정보 탭(비로그인에서 주문·퀘스트·퀴즈·아카데미 → 내정보 탭으로 이동). 에뮬레이터는 `adb reverse tcp:8003 tcp:8003` 추가(8000/8001/8002/8082 와 함께).
```

환경변수 표의 web_client `VITE_STOCK_API_URL` 행 바로 아래에 한 행:

```markdown
| `EXPO_PUBLIC_GAME_API_URL` | mobile (선택) | `http://localhost:8003` | 트레이딩 게임 API·WS(production 미설정 → 게임 탭 준비 중) |
```

- [ ] **Step 3: ROADMAP** — `  - [ ] **6c** 모바일(Expo) 동일 기능` 줄을 다음으로 교체(6a·6b·6c 모두 완료면 상위 `- [ ] **서브페이즈 6** — ...` 줄도 `- [x]` 로):

```markdown
  - [x] **6c** 모바일(Expo) 동일 기능 — 순수 View 캔들 차트·RN Modal 시트·AppState WS (2026-10-13)
```

- [ ] **Step 4: 설정 회귀** — `cd mobile && npx expo-doctor` → 이전과 같은 결과(새 경고 없음). `npx tsc --noEmit && npm test` 통과.

- [ ] **Step 5: 커밋**

```bash
git add mobile/.env.example README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP — 트레이딩 게임 6c(모바일 게임 화면) 반영·EXPO_PUBLIC_GAME_API_URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

- [ ] **Step 6: 스모크(컨트롤러)** — 스펙 §5.3. 6a/6b 와 같은 일회용 환경(로컬 docker 전용 PG DB·Redis DB 9, dev 터널 15432 금지).

**6-1. DB·Redis 준비**

```bash
docker exec stock_postgres createdb -U stock_user stock_p6c_smoke
docker exec stock_redis redis-cli -n 9 FLUSHDB
cd backend
export DATABASE_URL=postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_p6c_smoke
export SYNC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p6c_smoke
export REDIS_URL=redis://localhost:6379/9
uv run alembic upgrade head
uv run python -m scripts.seed_trading_game        # 시즌 1기(005930, ACTIVE) + 모닝 코치
```

퀴즈 3문제·명예의 전당 2행은 **6b 계획 Task 8 Step 4-3 의 SQL 을 DB 이름만 `stock_p6c_smoke` 로 바꿔 그대로 실행**(기대 `INSERT 0 3`, `INSERT 0 2`).

**6-2. 서비스 기동**(각 터미널에 위 export 3개 설정)

```bash
cd backend
uv run uvicorn apps.auth.main:app --port 8001
uv run uvicorn apps.blog.main:app --port 8000
uv run uvicorn apps.stock_api.main:app --port 8002
TRADING_WINDOWS=00:00-23:59 STALE_SECONDS=86400 uv run uvicorn apps.trading_game.main:app --port 8003 --workers 1
cd mobile && npx expo start --web --port 8082     # http://localhost:8082/game (.env.development 가 localhost 8001/8002/8003)
```
(8082 는 `shared/cors.py` 기본 허용 오리진. 8081 은 다른 프로젝트 점유.)

시세 키(주문 신선도 게이트) + 틱 시뮬레이션(차트 오늘 캔들·포지션 손익·심리 바 갱신 확인용, 몇 초 간격):

```bash
docker exec stock_redis redis-cli -n 9 SET stock:latest:005930 "{\"price\":71200,\"ts\":$(date +%s)}"
for p in 71200 71400 71100 71600 71800 71500; do
  docker exec stock_redis redis-cli -n 9 SET stock:latest:005930 "{\"price\":$p,\"ts\":$(date +%s)}"
  docker exec stock_redis redis-cli -n 9 PUBLISH stock:tick:005930 "{\"ticker\":\"005930\",\"price\":$p,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
  sleep 3
done
```

**6-3. 브라우저 확인**(Chrome, 창 폭 390px 근처 — react-native-web 렌더)

1. **비로그인**: 게임 탭 → 헤더 `시즌 1기 · 종료 D-n`·`삼성전자 (005930)`·"로그인하고 시즌에 참여하세요"·자본금 `—`, "로그인하면 실시간 시세와 주문이 열려요", 일봉 차트(최근 60개, 좌측 최고/최저 라벨). `🏆 랭킹` → 시트(배경이 테마색 — 흰 배경이면 회귀), 시즌 랭킹/명예의 전당 탭(`시즌 1` · `전설의개미` MBTI 칩 · 승률 `66.7%`), ✕ 닫기. `🎯 퀘스트`·`🧩 퀴즈`·`5x 🔒`·BUY → 내정보 탭으로 이동.
2. **로그인**: 내정보에서 닉네임 `스모크6c` → 게임 탭: 순위 문구, 자본금 `₩10,000,000`, 코치 배너(탭하면 본문 펼침), 차트에 지지(보라)/저항(주황) 선+라벨, 심리 바(WS sentiment 수신 후).
3. **틱**: 6-2 루프 실행 중 차트 마지막 캔들 종가/고가가 갱신(오늘 캔들 신규 또는 병합), 콘솔 에러 없음.
4. **주문/청산**: 25%·1x BUY → 포지션 카드(`LONG x1배`, 진입가, 진입선 빨강 2px), 틱마다 손익 ₩/% 색 갱신, 넛지가 있으면 상단 토스트(5초 후 사라짐·탭하여 닫기), 헤더 `🔥 1일 연속`. 보유 중 BUY/SELL 비활성 + "보유 포지션을 먼저 청산하세요". `즉시 전액 청산하기` → 카드 사라짐·자본금 갱신.
5. **퀘스트**: 6b 4-4 처럼 손절 주문을 API 로 넣은 뒤(닉네임 `스모크6c`) Q1 `보상 받기` → **시트 안에** 토스트 "보상을 받았어요" → `받음 ✓`, 닫으면 헤더 자본금 +₩500,000.
6. **아카데미**: `5x 🔒` → 오답 제출 → ❌·정답·해설·`다시 도전` → 정답(1번 3번째·2번 2번째·3번 3번째) → 시트 안 토스트 "5배 레버리지가 해금됐어요" → 닫으면 칩 `5x`(🔒 없음).
7. **퀴즈**: `🧩 퀴즈` → `시작` → 차트(라벨 없음) + `⏱ 10초`(3초 이하 빨강) → `오를까? 📈` → 결과(정답/오답·실제 5일 등락·패턴·해설·종목/기준일, 정답이면 `+₩200,000 지급`) → `다음 문제` → 10초 무응답 → `⏰ 시간 초과`(정답 미공개) → 소진 시 "준비된 문제를 모두 풀었어요"(다시 시도 없음). 플래그 OFF(6b 4-5 #7 SQL + `DEL game:flag:QUIZ`) → `시작` → 시트 닫힘 + 화면 토스트 "지금은 운영하지 않는 기능이에요" → 헤더 `🧩 퀴즈`·배너 사라짐. 확인 후 플래그 복구.
8. **배너**: KST 15:30 이후·주말이면 주문 패널 위 "🧩 야간 10초 차트 퀴즈 도전!"(평일 장중이면 없음 — 경계는 `quiz.test.ts` 로 대체).
9. **당겨서 새로고침·탭 전환**: 브라우저 탭을 다른 탭으로 전환했다 복귀(react-native-web AppState background→active) → WS 재연결·계좌 재조회(네트워크 탭에서 `/accounts/me` 재요청). 로그인 전용 시트를 연 채 내정보에서 로그아웃 → 게임 탭 복귀 시 시트 닫힘.
10. **네이티브 전용(가능 시)**: 에뮬레이터 dev build + `adb reverse tcp:8003 tcp:8003`(및 8000/8001/8002/8082) → iOS pageSheet 쓸어 닫기·Android 뒤로가기로 시트 닫힘·앱 백그라운드 후 복귀 시 재연결. 불가하면 **미검증으로 보고**.

**6-4. 정리**: 서버 종료 → `docker exec stock_postgres dropdb -U stock_user stock_p6c_smoke` → `docker exec stock_redis redis-cli -n 9 FLUSHDB`.

---

## 스펙 대응표 (셀프 리뷰)

| 스펙 | 태스크 |
|---|---|
| §1 코어(헤더·D-day·순위·자본금·Streak·코치 펼침·심리 바·차트·포지션 원클릭 청산·주문 5x 🔒·토스트) | 6, 7, 9 |
| §1 모달 4종(랭킹 Top100/명예의 전당 MBTI·퀘스트·아카데미·야간 퀴즈 + 15:30/주말 배너) | 8, 6(`quiz-banner`), 9 |
| §1 제외(지인 리그·MBTI 공유 이미지·푸시·햅틱·카운팅 애니메이션) | 미구현(범위 밖) |
| §2.1 순수 View 차트 · `layoutCandles` jest · 일봉 60개 · 퀴즈 재사용(라벨 숨김) | 3, 7, 8 |
| §2.2 RN Modal slide·pageSheet·`onRequestClose`, 라우트 모달 미사용 | 8 (`sheet`) |
| §2.3 `createHttpClient(ENV.gameApiUrl)` · 401 공통 정책 | 4 |
| §2.4 비로그인 → 토스트 + `router.push('/(tabs)/profile')` | 9 |
| §2.5 RN WebSocket · 백오프·4401·25초 ping·재연결 재조회 · AppState | 5 |
| §2.6 `EXPO_PUBLIC_GAME_API_URL` 선택(dev localhost·prod undefined) · 일봉 `stockGraphqlUrl` | 1, 4 |
| §2.7 순수 로직 복제(같은 시그니처·문구) + jest | 1–3 |
| §2.8 zustand 스토어(privateGen·refreshSeq) · 시트 로컬 state | 5, 8 |
| §3 파일 구조 | 전 태스크(파일 표와 1:1) |
| §3 `@/ui` formatWon/formatSignedWon/formatPct·AmountText 재사용, 테마 토큰, 지지 `#8b5cf6`·저항 `#f59e0b` | 6–8 |
| §4 상태 분기 4종 · `RefreshControl` · 토스트 상단·5초·탭 닫기 · 퀴즈 규칙/문구 = 6b | 6, 8, 9 |
| §5.1 tsc·jest·expo-doctor | 각 태스크, 10 |
| §5.2 jest: decimal·ws·errors·candles(시계 오차)·quiz·chart-layout(가격→y·패딩·가격선 범위·빈 입력) | 1–3 |
| §5.3 스모크(Expo web 8082)·네이티브 전용 미검증 보고 · §5.4 `adb reverse tcp:8003` | 10 |
| §6 README·`.env`·ROADMAP | 10 |

## 위험 · 메모

- **react-native-web Modal**: `presentationStyle`(pageSheet)·스와이프 닫기는 web 에서 무시(전체 화면 dialog). Escape 키는 `onRequestClose` 로 닫힘. 계획 검증(mock 서버 + `expo start --web`)에서 4종 시트 렌더·탭 전환·결과 화면·시트 내 토스트 확인 완료.
- **Unistyles 서드파티 컴포넌트**: 검증 중 `SafeAreaView` 에 준 배경색이 web 에서 누락 → `View`+insets 로 수정 반영됨. 같은 실수를 반복하지 않도록 공통 규칙에 명시.
- **Android 전체 화면 Modal + edge-to-edge**: 상단 inset 을 패딩으로 주지만, `react-native-edge-to-edge` 와 Modal `statusBarTranslucent` 조합에 따라 이중/누락 여백이 생길 수 있음 — 에뮬레이터 확인 항목.
- **언마운트 시 닫힘 애니메이션 생략**(조건부 마운트 선택의 대가).
- **비로그인 이동 시 토스트**는 게임 탭에 쌓이므로 내정보 탭에서는 보이지 않는다(5초 후 자동 소멸).
- **`formatPct(-0.04)` = `'-0.0%'`**(`@/ui` 동작) — web 과 미세 차이.
- **틱 빈도**: 틱마다 화면 전체 대신 구독 필드만 리렌더(필드별 셀렉터). 차트는 60캔들 × 2 View 라 부담 작음.

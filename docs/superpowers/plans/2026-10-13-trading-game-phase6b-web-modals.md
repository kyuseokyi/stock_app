# 트레이딩 게임 서브페이즈 6b — web_client 게임 모달 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6a 게임 화면에 에듀테인먼트 모달 4종(랭킹/명예의 전당 · 퀘스트 · 아카데미 · 야간 10초 차트 퀴즈)과 진입점(헤더 버튼·장 마감 후 배너·5x 🔒 칩), 헤더 Streak 칩을 붙인다.

**Architecture:** 백엔드 변경 없음(Phase 5b API 그대로). 프론트는 6a와 같은 `types → lib(순수 함수) → api → store(zustand) → components → page` 단방향 레이어. 모달 내부 데이터(목록·문항·퀴즈 진행)는 **모달 로컬 state**(열 때 마운트·로드, 닫으면 언마운트로 폐기), 전역 스토어에는 화면 간 공유값(`streak`·`academyUnlocked`·`quizDisabled`)만 둔다. 모달은 한 번에 하나(`activeModal`).

**Tech Stack:** React 18 + TS strict + Vite + Tailwind + zustand v4 + axios + lightweight-charts 4.2.3 (web_client)

**스펙:** `docs/superpowers/specs/2026-10-13-trading-game-phase6b-web-modals-design.md`

---

## 공통 규칙 (모든 태스크)

- 브랜치 `dev`. 스테이징은 명시 경로만(`git add -A`/`git add .` 금지). `.claude/`·`.serena/project.yml` 절대 스테이징 금지.
- 커밋 메시지 끝에 정확히:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh
  ```
- web_client 검증(프론트 태스크 공통 종료 조건):
  ```bash
  cd web_client
  npx tsc --noEmit
  VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
  ```
- TS 규칙: 명시적 `any`·`@ts-ignore` 금지. `as`는 외부 데이터 경계에서만(이 계획의 유일한 예외: `QuizMiniChart`의 `UTCTimestamp` 브랜드 단언 1곳 — 근거 주석 포함), `!`는 근거 주석과 함께만(이 계획에는 없음).
- Tailwind는 기존 토큰만(`brand`/`brand-soft`/`up`/`down`/`ink`/`ink-muted`/`surface`/`line`, `rounded-card`/`rounded-btn`/`rounded-field`). UI 프리미티브는 기존 `Card`·`Button`·`Chip`/`chipClass`·`EmptyState` 재사용 + 신규 `ui/Modal`.
- 6a 동작 보존: `orderErrorMessage` 문구(401·403 LEVERAGE_LOCKED·문자열 detail·422 배열·네트워크), 스토어 `privateGen`/`refreshSeq` 경쟁 가드, `GamePage` 지연 로딩(`App.tsx` 무수정).
- 기존 파일 수정은 `types/game.ts`(끝에 추가)·`api/game.ts`·`lib/gameErrors.ts`·`store/tradingGame.ts`·`components/game/GameHeader.tsx`·`pages/GamePage.tsx`·README·ROADMAP뿐. `OrderPanel`·`NudgeToaster`·`App.tsx`·`LoginModal`·`lib/format.ts`는 건드리지 않는다.
- 순수 함수 확인(테스트 러너 없음): `npx tsc`로 세션 스크래치 디렉터리에 CommonJS로 컴파일 → `node` assert. 스크래치 경로:
  `SP=/private/tmp/claude-501/-Users-kyuseok-Documents-private-projects-ivyro-work-space-stock-app/7aa4f14a-93aa-4418-a0e6-52bef2295e16/scratchpad`
  출력 디렉터리는 태스크별 고유 이름(`$SP/6b-t1`)을 쓰고 **삭제(rm)하지 않는다**(tsc 가 덮어씀).

## 파일 구조

| 파일 | 책임 |
|---|---|
| `web_client/src/types/game.ts` (끝에 추가) | 리더보드·명예의 전당·퀘스트·뱃지·수령·아카데미·퀴즈·Streak 타입(Raw=Decimal 문자열, 도메인=number) |
| `web_client/src/api/game.ts` (교체) | + `getLeaderboard`·`getHallOfFame`·`getQuests`·`claimQuest`·`getAcademyQuiz`·`submitAcademy`·`getRandomQuiz`·`submitQuiz`·`getMyStreak` (Dec→number, 퀴즈 캔들 검증) |
| `web_client/src/lib/gameErrors.ts` (교체) | + `apiErrorCode`·`gameErrorMessage`(객체 detail `{code,message}`), `orderErrorMessage`는 위임하되 6a 문구 유지 |
| `web_client/src/lib/quiz.ts` (신규) | `isQuizPrimeTime(now)`·`quizSecondsLeft(startedAtMs, limitSec, nowMs)` |
| `web_client/src/store/tradingGame.ts` (교체) | + `streak`·`quizDisabled`·`refreshStreak`·`setAcademyUnlocked`·`setStreak`·`markQuizDisabled`·`currentPrivateGen` |
| `web_client/src/components/ui/Modal.tsx` (신규) | 공용 모달(오버레이·ESC/바깥 클릭·role=dialog·aria-modal·모바일 하단 시트) |
| `web_client/src/components/game/LeaderboardModal.tsx` (신규) | 시즌 Top 100 / 명예의 전당(MBTI 칩) 탭 |
| `web_client/src/components/game/QuestModal.tsx` (신규) | 퀘스트 진행률·보상 수령·보유 뱃지 |
| `web_client/src/components/game/AcademyModal.tsx` (신규) | 3문항 → 5배 레버리지 해금 |
| `web_client/src/components/game/QuizMiniChart.tsx` (신규) | 퀴즈용 미니 캔들(순번 시간축, 라벨 숨김) |
| `web_client/src/components/game/ChartQuizModal.tsx` (신규) | 야간 10초 차트 퀴즈(intro→loading→playing→submitting→result/error) |
| `web_client/src/components/game/QuizBanner.tsx` (신규) | 장 마감 후/주말 퀴즈 배너 |
| `web_client/src/components/game/GameHeader.tsx` (교체) | 랭킹·퀘스트 버튼 활성화, 🧩 퀴즈 버튼, 🔥 Streak 칩 |
| `web_client/src/pages/GamePage.tsx` (교체) | `activeModal` 상태·진입점 연결·로그인 분기·퀴즈 배너 |
| `README.md`, `docs/ROADMAP.md` (수정) | 6b 반영 |

### 백엔드 계약 메모(구현 중 재확인 불필요 — 계획 작성 시 확인 완료)

- 리더보드/명예의 전당은 **이미 float**(라우터에서 `float()` 변환). `win_rate`는 **0~100 부호 없는 퍼센트**(`ranking_service.top_leaderboard`·`settlement.py`) → `formatPct`(+부호) 대신 `toFixed(1)%`.
- 명예의 전당 응답에는 `season_number`가 없고 `season_id`만 있다 → 그룹 헤더는 `시즌 {season_id}`(시드/운영에서 id=번호가 일반적이나 보장되지 않음 — 스펙 갭, 백엔드 변경 없음 원칙상 그대로).
- 퀴즈 `chart_snapshot`은 `list[dict]`(스키마 없음) → api 계층에서 OHLC 숫자 검증 후 `QuizCandle[]`로 변환.
- 퀴즈 제출 응답 `streak`은 STREAK 플래그가 켜졌고 갱신 성공했을 때만 객체(`enabled: true`), 아니면 `null`.
- 주문 라우터의 객체 detail 은 `LEVERAGE_LOCKED`(403) 하나뿐 → `orderErrorMessage` 위임 후에도 주문 오류 문구는 6a와 동일.

---

### Task 1: 타입 · API · 오류 문구 · 퀴즈 순수 함수

**Files:**
- Modify: `web_client/src/types/game.ts`(끝에 추가), `web_client/src/api/game.ts`(전체 교체), `web_client/src/lib/gameErrors.ts`(전체 교체)
- Create: `web_client/src/lib/quiz.ts`

- [ ] **Step 0: 메인 청크 기준선 기록(코드 수정 전, Task 7 비교용)**

```bash
SP=/private/tmp/claude-501/-Users-kyuseok-Documents-private-projects-ivyro-work-space-stock-app/7aa4f14a-93aa-4418-a0e6-52bef2295e16/scratchpad
cd web_client
VITE_API_BASE_URL=http://x VITE_AUTH_BASE_URL=http://x npm run build
wc -c < "$(ls dist/assets/index-*.js)" | tr -d ' ' > "$SP/6b-main-chunk-baseline.txt"
cat "$SP/6b-main-chunk-baseline.txt"
```
기대: 빌드 통과, 숫자 1개 출력(작성 시점 약 `230186`).

- [ ] **Step 1: `src/types/game.ts` — 파일 끝(`GameWsMessage` 정의 다음)에 빈 줄 하나 두고 아래 블록을 그대로 추가**(기존 내용은 수정하지 않음)

```ts
// ---------------------------------------------------------------- 6b: 모달(랭킹·퀘스트·아카데미·퀴즈·Streak)
// 출처: routers/{leaderboard,quests,academy,quiz}.py, services/ranking_service.py, schemas/game_dtos.py

/** GET /api/game/seasons/{id}/leaderboard (ranking_service.top_leaderboard — 이미 float, win_rate 0~100) */
export interface LeaderboardRow {
  rank: number
  user_id: number
  nickname: string | null
  roi_pct: number
  total_asset: number | null
  win_rate: number
}

/** GET /api/game/hall-of-fame (이미 float, win_rate 0~100). 시즌 번호 없이 season_id 만 제공 */
export interface HallOfFameRow {
  season_id: number
  rank: number
  nickname: string
  final_roi: number
  final_asset: number
  win_rate: number
  trading_mbti: string | null
}

export interface RawQuest {
  code: string
  title: string
  description: string
  target: number
  progress: number
  reward_cash: Dec | null
  reward_badge: string | null
  completed: boolean
  claimed: boolean
}

export interface Quest {
  code: string
  title: string
  description: string
  target: number
  progress: number
  reward_cash: number | null
  reward_badge: string | null
  completed: boolean
  claimed: boolean
}

export interface Badge {
  code: string
  name: string
  awarded_at: string | null
}

export interface RawQuestList {
  quests: RawQuest[]
  badges: Badge[]
}

export interface QuestList {
  quests: Quest[]
  badges: Badge[]
}

export interface RawClaimResult {
  quest: RawQuest
  cash_balance: Dec | null
  badge: Badge | null
}

export interface ClaimResult {
  quest: Quest
  cash_balance: number | null
  badge: Badge | null
}

export interface AcademyQuestion {
  id: number
  question: string
  choices: string[]
}

export interface AcademyQuiz {
  unlocked: boolean
  questions: AcademyQuestion[]
}

export interface AcademyResultItem {
  id: number
  correct: boolean
  /** 정답 선택지 인덱스(0-based) */
  answer: number
  explanation: string
}

export interface AcademySubmitResult {
  unlocked: boolean
  results: AcademyResultItem[]
}

/** 퀴즈 차트 캔들(첫 종가=100 정규화, 날짜 없음) */
export interface QuizCandle {
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

/** GET /api/game/quiz/random — chart_snapshot 은 list[dict](스키마 없음) → api 계층에서 검증·변환 */
export interface RawQuizQuestion {
  id: number
  chart_snapshot: Record<string, unknown>[]
  time_limit_sec: number
}

export interface QuizQuestion {
  id: number
  chart_snapshot: QuizCandle[]
  time_limit_sec: number
}

export type QuizChoice = 'UP' | 'DOWN'

/** GET /api/game/streak/my (StreakResponse) */
export interface Streak {
  current_streak: number
  highest_streak: number
  last_activity_date: string | null
  enabled: boolean
}

export interface RawQuizResult {
  correct: boolean
  answer: QuizChoice
  actual_change: Dec
  pattern_type: string
  explanation: string
  rewarded: boolean
  reward_cash: number
  timed_out: boolean
  ticker: string
  base_date: string
  streak: Streak | null
}

export interface QuizResult {
  correct: boolean
  answer: QuizChoice
  /** 기준일 대비 5거래일 후 등락률(%) */
  actual_change: number
  pattern_type: string
  explanation: string
  rewarded: boolean
  reward_cash: number
  timed_out: boolean
  ticker: string
  base_date: string
  streak: Streak | null
}
```

- [ ] **Step 2: `src/api/game.ts` 전체 교체**(6a 함수·변환은 그대로, `getAcademyUnlocked`도 유지 — `loadPrivate`가 사용)

```ts
import type { AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import { toNum, toNumOrNull } from '../lib/decimal'
import type {
  AcademyQuiz, AcademySubmitResult, Account, ClaimResult, Coach, HallOfFameRow, LeaderboardRow, MyRank,
  OrderRequest, OrderResult, Position, Quest, QuestList, QuizCandle, QuizChoice, QuizQuestion, QuizResult,
  RawAccount, RawClaimResult, RawCoachMessage, RawCoachToday, RawOrderResult, RawPosition, RawQuest,
  RawQuestList, RawQuizQuestion, RawQuizResult, Season, Streak,
} from '../types/game'

// trading_game REST. Decimal 문자열은 여기서 number 로 변환해 UI 는 number 만 다룬다.

function client(): AxiosInstance {
  if (!gameClient) throw new Error('GAME_API_URL 미설정')
  return gameClient
}

export const toPosition = (r: RawPosition): Position => ({
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
})

const toAccount = (r: RawAccount): Account => ({
  season_id: r.season_id,
  cash_balance: toNum(r.cash_balance),
  total_asset: toNum(r.total_asset),
  current_roi: toNum(r.current_roi),
  total_trades: r.total_trades,
  win_trades: r.win_trades,
})

const toCoach = (m: RawCoachMessage): Coach => ({
  season_id: m.season_id,
  coach_type: m.coach_type,
  title: m.title,
  summary_nudge: m.summary_nudge,
  content_md: m.content_md,
  support_price: toNumOrNull(m.support_price),
  resistance_price: toNumOrNull(m.resistance_price),
})

const toOrderResult = (r: RawOrderResult): OrderResult => ({ position: toPosition(r), nudges: r.nudges })

const toQuest = (r: RawQuest): Quest => ({ ...r, reward_cash: toNumOrNull(r.reward_cash) })

/** 스키마 없는 dict → 캔들. OHLC 중 하나라도 숫자가 아니면 그 캔들은 버린다(차트 예외 방지) */
const toQuizCandles = (raw: Record<string, unknown>[]): QuizCandle[] => {
  const out: QuizCandle[] = []
  for (const c of raw) {
    const open = toNumOrNull(c.open)
    const high = toNumOrNull(c.high)
    const low = toNumOrNull(c.low)
    const close = toNumOrNull(c.close)
    if (open === null || high === null || low === null || close === null) continue
    const volume = toNumOrNull(c.volume)
    out.push(volume === null ? { open, high, low, close } : { open, high, low, close, volume })
  }
  return out
}

const toQuizResult = (r: RawQuizResult): QuizResult => ({ ...r, actual_change: toNum(r.actual_change) })

/** 공개 — 활성 시즌 없으면 null */
export async function getActiveSeason(): Promise<Season | null> {
  const { data } = await client().get<Season | null>('/api/game/seasons/active')
  return data
}

export async function getMyAccount(seasonId: number): Promise<Account> {
  const { data } = await client().get<RawAccount>('/api/game/accounts/me', { params: { season_id: seasonId } })
  return toAccount(data)
}

/** 보유 포지션(서버 규칙상 최대 1개) — 없으면 null */
export async function getActivePosition(seasonId: number): Promise<Position | null> {
  const { data } = await client().get<RawPosition[]>('/api/game/positions/active', { params: { season_id: seasonId } })
  return data.length > 0 ? toPosition(data[0]) : null
}

export async function getMyRank(seasonId: number): Promise<MyRank> {
  const { data } = await client().get<MyRank>(`/api/game/seasons/${seasonId}/my-rank`)
  return data
}

/** 오늘의 코치(evening 우선 active) — 없으면 null */
export async function getTodayCoach(): Promise<Coach | null> {
  const { data } = await client().get<RawCoachToday>('/api/game/coach/today')
  return data.active ? toCoach(data.active) : null
}

/** 5배 레버리지 해금 여부만(loadPrivate 용). 문항까지 필요하면 getAcademyQuiz */
export async function getAcademyUnlocked(): Promise<boolean> {
  const { data } = await client().get<{ unlocked: boolean }>('/api/game/academy/quiz')
  return data.unlocked
}

export async function placeOrder(body: OrderRequest): Promise<OrderResult> {
  const { data } = await client().post<RawOrderResult>('/api/game/orders', body)
  return toOrderResult(data)
}

export async function closePosition(positionId: string): Promise<OrderResult> {
  const { data } = await client().post<RawOrderResult>(`/api/game/positions/${positionId}/close`)
  return toOrderResult(data)
}

// ---------------------------------------------------------------- 6b: 모달

/** 공개 — 시즌 Top 100 */
export async function getLeaderboard(seasonId: number): Promise<LeaderboardRow[]> {
  const { data } = await client().get<LeaderboardRow[]>(`/api/game/seasons/${seasonId}/leaderboard`)
  return data
}

/** 공개 — 명예의 전당(시즌 desc · 순위 asc, 최대 300) */
export async function getHallOfFame(): Promise<HallOfFameRow[]> {
  const { data } = await client().get<HallOfFameRow[]>('/api/game/hall-of-fame')
  return data
}

export async function getQuests(): Promise<QuestList> {
  const { data } = await client().get<RawQuestList>('/api/game/quests')
  return { quests: data.quests.map(toQuest), badges: data.badges }
}

export async function claimQuest(code: string): Promise<ClaimResult> {
  const { data } = await client().post<RawClaimResult>(`/api/game/quests/${encodeURIComponent(code)}/claim`)
  return { quest: toQuest(data.quest), cash_balance: toNumOrNull(data.cash_balance), badge: data.badge }
}

export async function getAcademyQuiz(): Promise<AcademyQuiz> {
  const { data } = await client().get<AcademyQuiz>('/api/game/academy/quiz')
  return data
}

/** answers: 문항 id → 선택 인덱스(0-based) */
export async function submitAcademy(answers: Record<number, number>): Promise<AcademySubmitResult> {
  const { data } = await client().post<AcademySubmitResult>('/api/game/academy/submit', { answers })
  return data
}

export async function getRandomQuiz(): Promise<QuizQuestion> {
  const { data } = await client().get<RawQuizQuestion>('/api/game/quiz/random')
  return { id: data.id, chart_snapshot: toQuizCandles(data.chart_snapshot), time_limit_sec: data.time_limit_sec }
}

export async function submitQuiz(quizId: number, choice: QuizChoice): Promise<QuizResult> {
  const { data } = await client().post<RawQuizResult>(`/api/game/quiz/${quizId}/submit`, { choice })
  return toQuizResult(data)
}

export async function getMyStreak(): Promise<Streak> {
  const { data } = await client().get<Streak>('/api/game/streak/my')
  return data
}
```

- [ ] **Step 3: `src/lib/gameErrors.ts` 전체 교체**

```ts
import axios from 'axios'

// 게임 API 실패 → 사용자 문구.
// detail 이 문자열(주문 409/422 등, 이미 한국어 문장)이면 그대로, 객체 {code, message}(퀘스트·퀴즈·레버리지 잠금)면
// code 별 고정 문구 → 없으면 message.

const NETWORK = '게임 서버에 연결할 수 없어요'
const EXPIRED = '로그인이 만료되었어요. 다시 로그인해 주세요'

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
])

/** 응답 본문의 detail(문자열·객체·배열) — 응답이 없으면 undefined */
function errorDetail(err: unknown): unknown {
  if (!axios.isAxiosError(err) || !err.response) return undefined
  const data: unknown = err.response.data
  return typeof data === 'object' && data !== null && 'detail' in data ? data.detail : undefined
}

/** 객체 detail 의 code(문자열일 때만), 없으면 null */
export function apiErrorCode(err: unknown): string | null {
  const detail = errorDetail(err)
  if (typeof detail === 'object' && detail !== null && 'code' in detail && typeof detail.code === 'string') {
    return detail.code
  }
  return null
}

export function gameErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response) return NETWORK
  const { status } = err.response
  if (status === 401) return EXPIRED
  const code = apiErrorCode(err)
  const mapped = code === null ? undefined : CODE_MESSAGES.get(code)
  if (mapped !== undefined) return mapped
  const detail = errorDetail(err)
  if (typeof detail === 'object' && detail !== null && 'message' in detail && typeof detail.message === 'string') {
    return detail.message
  }
  if ((status === 403 || status === 404 || status === 409 || status === 422) && typeof detail === 'string') {
    return detail
  }
  return NETWORK
}

/** 주문/청산 실패 — 6a 동작 유지: 422 검증 오류(배열 detail)는 '주문 조건이 올바르지 않아요', 나머지는 gameErrorMessage */
export function orderErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response?.status === 422) {
    const detail = errorDetail(err)
    if (typeof detail !== 'string') return '주문 조건이 올바르지 않아요'
  }
  return gameErrorMessage(err)
}
```

- [ ] **Step 4: `src/lib/quiz.ts` 생성**

```ts
// 야간 차트 퀴즈 순수 함수(시간 판정·카운트다운). 판정 시각은 인자로 받아 테스트 가능하게 둔다.

const KST_OFFSET_MS = 9 * 3_600_000
const PRIME_START_MIN = 15 * 60 + 30 // KST 15:30 (정규장 마감)

/** 퀴즈 강조 시간 — KST 평일 15:30~24:00, 또는 토/일 종일 */
export function isQuizPrimeTime(now: Date): boolean {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const day = kst.getUTCDay() // 0=일 … 6=토 (KST 기준)
  if (day === 0 || day === 6) return true
  return kst.getUTCHours() * 60 + kst.getUTCMinutes() >= PRIME_START_MIN
}

/** 남은 초(올림, 0 미만은 0). startedAtMs/nowMs 는 epoch ms. 시작 순간 = limitSec, 정확히 limitSec 경과 = 0 */
export function quizSecondsLeft(startedAtMs: number, limitSec: number, nowMs: number): number {
  const remainMs = startedAtMs + limitSec * 1000 - nowMs
  return remainMs <= 0 ? 0 : Math.ceil(remainMs / 1000)
}
```

- [ ] **Step 5: 검증** — 공통 web_client 검증 명령. 기대: 통과(스토어는 아직 `orderErrorMessage`만 import — 시그니처 동일).

- [ ] **Step 6: 순수 함수 경계값 실행 확인(스크래치 컴파일 + node assert)**

검사 스크립트를 스크래치에 작성(저장소 밖):

```bash
SP=/private/tmp/claude-501/-Users-kyuseok-Documents-private-projects-ivyro-work-space-stock-app/7aa4f14a-93aa-4418-a0e6-52bef2295e16/scratchpad
cat > "$SP/6b-t1-check.cjs" <<'EOF'
const assert = require('node:assert/strict')
const S = process.argv[2]
const { isQuizPrimeTime, quizSecondsLeft } = require(`${S}/lib/quiz.js`)
const { apiErrorCode, gameErrorMessage, orderErrorMessage } = require(`${S}/lib/gameErrors.js`)

// isQuizPrimeTime — KST = UTC+9. 2026-10-13(화), 10-17(토), 10-18(일), 10-19(월)
assert.equal(isQuizPrimeTime(new Date('2026-10-13T06:29:59Z')), false) // 화 15:29:59
assert.equal(isQuizPrimeTime(new Date('2026-10-13T06:30:00Z')), true) //  화 15:30:00
assert.equal(isQuizPrimeTime(new Date('2026-10-13T14:59:59Z')), true) //  화 23:59:59
assert.equal(isQuizPrimeTime(new Date('2026-10-13T15:00:00Z')), false) // 수 00:00:00
assert.equal(isQuizPrimeTime(new Date('2026-10-14T00:00:00Z')), false) // 수 09:00
assert.equal(isQuizPrimeTime(new Date('2026-10-16T15:00:00Z')), true) //  토 00:00
assert.equal(isQuizPrimeTime(new Date('2026-10-17T01:00:00Z')), true) //  토 10:00
assert.equal(isQuizPrimeTime(new Date('2026-10-18T14:59:59Z')), true) //  일 23:59:59
assert.equal(isQuizPrimeTime(new Date('2026-10-18T15:00:00Z')), false) // 월 00:00

// quizSecondsLeft — 올림, 0 하한
assert.equal(quizSecondsLeft(0, 10, 0), 10)
assert.equal(quizSecondsLeft(0, 10, 1), 10)
assert.equal(quizSecondsLeft(0, 10, 9000), 1)
assert.equal(quizSecondsLeft(0, 10, 9999), 1)
assert.equal(quizSecondsLeft(0, 10, 10000), 0)
assert.equal(quizSecondsLeft(0, 10, 12000), 0)

// 오류 문구 — axios.isAxiosError 는 isAxiosError === true 인 객체를 인정
const ax = (status, data) => ({ isAxiosError: true, response: { status, data } })
const obj = (status, code, message) => ax(status, { detail: { code, message } })

assert.equal(gameErrorMessage(new Error('x')), '게임 서버에 연결할 수 없어요')
assert.equal(gameErrorMessage({ isAxiosError: true }), '게임 서버에 연결할 수 없어요')
assert.equal(gameErrorMessage(ax(401, { detail: 'x' })), '로그인이 만료되었어요. 다시 로그인해 주세요')
assert.equal(gameErrorMessage(obj(404, 'NO_QUIZ_AVAILABLE', 'm')), '준비된 문제를 모두 풀었어요')
assert.equal(gameErrorMessage(obj(503, 'FEATURE_DISABLED', 'm')), '지금은 운영하지 않는 기능이에요')
assert.equal(gameErrorMessage(obj(409, 'QUIZ_NOT_SERVED', 'm')), '이미 제출했거나 만료된 문제예요')
assert.equal(gameErrorMessage(obj(409, 'ALREADY_SUBMITTED', 'm')), '이미 제출했거나 만료된 문제예요')
assert.equal(gameErrorMessage(obj(409, 'QUEST_NOT_COMPLETED', 'm')), '아직 완료하지 않은 퀘스트예요')
assert.equal(gameErrorMessage(obj(409, 'ALREADY_CLAIMED', 'm')), '이미 받은 보상이에요')
assert.equal(gameErrorMessage(obj(409, 'NO_ACTIVE_SEASON', 'm')), '진행 중인 시즌이 없어요')
assert.equal(gameErrorMessage(obj(409, 'PRICE_UNAVAILABLE', 'm')), '시세를 확인할 수 없어요. 잠시 후 다시 시도해 주세요')
assert.equal(gameErrorMessage(obj(404, 'QUEST_NOT_FOUND', '없는 퀘스트')), '없는 퀘스트')
assert.equal(gameErrorMessage(obj(409, 'toString', '프로토타입 키')), '프로토타입 키')
assert.equal(gameErrorMessage(ax(409, { detail: '이미 보유 중인 포지션이 있습니다.' })), '이미 보유 중인 포지션이 있습니다.')
assert.equal(gameErrorMessage(ax(500, { detail: '내부 오류' })), '게임 서버에 연결할 수 없어요')
assert.equal(apiErrorCode(obj(503, 'FEATURE_DISABLED', 'm')), 'FEATURE_DISABLED')
assert.equal(apiErrorCode(ax(409, { detail: 'x' })), null)
assert.equal(apiErrorCode(new Error('x')), null)

// orderErrorMessage — 6a 회귀
assert.equal(orderErrorMessage(new Error('x')), '게임 서버에 연결할 수 없어요')
assert.equal(orderErrorMessage(ax(401, {})), '로그인이 만료되었어요. 다시 로그인해 주세요')
assert.equal(orderErrorMessage(obj(403, 'LEVERAGE_LOCKED', '서버 문장')), '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요')
assert.equal(orderErrorMessage(ax(409, { detail: '지금은 거래 시간이 아닙니다.' })), '지금은 거래 시간이 아닙니다.')
assert.equal(orderErrorMessage(ax(422, { detail: '비중이 올바르지 않습니다.' })), '비중이 올바르지 않습니다.')
assert.equal(orderErrorMessage(ax(422, { detail: [{ loc: ['body', 'ratio'], msg: 'x' }] })), '주문 조건이 올바르지 않아요')
assert.equal(orderErrorMessage(ax(503, { detail: '시세 서버에 연결할 수 없습니다.' })), '게임 서버에 연결할 수 없어요')

console.log('6b pure functions OK')
EOF
```

컴파일·실행(`--rootDir src` 로 출력 경로를 `$SP/6b-t1/lib/*.js`로 고정, axios 는 `NODE_PATH`로 web_client 의 node_modules 에서 해석):

```bash
cd web_client
npx tsc --outDir "$SP/6b-t1" --rootDir src --module commonjs --target es2020 --lib es2020,dom \
  --esModuleInterop --skipLibCheck --strict src/lib/quiz.ts src/lib/gameErrors.ts
NODE_PATH="$PWD/node_modules" node "$SP/6b-t1-check.cjs" "$SP/6b-t1"
```
기대 출력(정확히 한 줄): `6b pure functions OK` — assert 실패 시 `AssertionError` 와 함께 종료 코드 1.

- [ ] **Step 7: 커밋**

```bash
git add web_client/src/types/game.ts web_client/src/api/game.ts web_client/src/lib/gameErrors.ts web_client/src/lib/quiz.ts
git commit -m "feat(web): 게임 6b 기반 — 모달 계약 타입·API 9종·객체 detail 오류 문구(gameErrorMessage)·퀴즈 시간 순수 함수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 2: 스토어 — Streak · 퀴즈 비활성 · 아카데미 해금 반영

**Files:** Modify `web_client/src/store/tradingGame.ts`(전체 교체)

변경 요지(6a 대비): `PrivateState.streak` 추가(로그아웃 시 초기화), 비공개 범위 밖 `quizDisabled`(로그아웃해도 유지 — 서버 전역 플래그), `loadPrivate`에 `getMyStreak`(실패 무시), `placeOrder` 성공 시 `refreshStreak()`, 모달용 동기 setter(`setAcademyUnlocked`·`setStreak`)는 **요청 시작 시 캡처한 `gen`** 을 받아 `privateGen`과 다르면 무시, `currentPrivateGen()` export. 기존 `refreshTrading`/`refreshRank`/`closePosition`/`applyMessage`/토스트 로직은 그대로.

- [ ] **Step 1: `src/store/tradingGame.ts` 전체 교체**

```ts
import { create } from 'zustand'
import * as gameApi from '../api/game'
import { gameClient } from '../api/gameClient'
import { orderErrorMessage } from '../lib/gameErrors'
import type {
  Account, Coach, GameWsMessage, Leverage, MyRank, Nudge, Position, Ratio, Season, Sentiment, Side, Streak,
} from '../types/game'

// 트레이딩 게임 전역 상태. 공개 데이터(시즌)와 로그인 데이터(계좌·포지션·순위·코치·해금·Streak·WS 실시간)를 분리한다.
// 모달 내부 데이터(랭킹 목록·퀘스트·문항·퀴즈 진행)는 각 모달의 로컬 state — 여기엔 화면 간 공유값만 둔다.

export type GameStatus = 'loading' | 'ready' | 'no-season' | 'unavailable' | 'error'

export interface GameToast {
  id: number
  kind: 'nudge' | 'error' | 'info'
  icon: string
  message: string
}

interface PrivateState {
  account: Account | null
  position: Position | null
  myRank: MyRank | null
  coach: Coach | null
  academyUnlocked: boolean
  streak: Streak | null
  lastPrice: number | null
  sentiment: Sentiment | null
}

interface TradingGameState extends PrivateState {
  status: GameStatus
  season: Season | null
  submitting: boolean
  closing: boolean
  toasts: GameToast[]
  /** 퀴즈 API 가 503 FEATURE_DISABLED 를 준 뒤 이 세션 동안 퀴즈 진입점 숨김(로그아웃해도 유지 — 서버 전역 플래그) */
  quizDisabled: boolean
  loadSeason: () => Promise<void>
  loadPrivate: () => Promise<void>
  refreshTrading: () => Promise<void>
  refreshRank: () => Promise<void>
  refreshStreak: () => Promise<void>
  resetPrivate: () => void
  placeOrder: (side: Side, ratio: Ratio, leverage: Leverage) => Promise<void>
  closePosition: () => Promise<void>
  applyMessage: (msg: GameWsMessage) => void
  /** gen = 요청 시작 시점의 currentPrivateGen() — 그 사이 로그아웃했으면 무시 */
  setAcademyUnlocked: (unlocked: boolean, gen: number) => void
  /** 퀴즈 제출 응답의 streak 반영. gen 규칙은 setAcademyUnlocked 와 동일 */
  setStreak: (streak: Streak, gen: number) => void
  markQuizDisabled: () => void
  pushToast: (t: Omit<GameToast, 'id'>) => void
  dismissToast: (id: number) => void
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
}

const NUDGE_ICON: Record<string, string> = { WARNING: '⚠️', PRAISE: '👏', ADVICE: '💡' }
let toastSeq = 0
// 경쟁 상태 가드: privateGen은 resetPrivate(로그아웃)마다 증가 — 요청 시작 시점과 달라졌으면 늦게 도착한 응답을 버린다.
// refreshSeq는 재조회 호출 순번 — 더 최신 호출이 있으면 순서가 뒤바뀌어 도착한 이전 응답을 버린다.
let privateGen = 0
let refreshSeq = 0

/** 모달 등 스토어 밖에서 비동기 요청을 시작할 때 캡처 → setAcademyUnlocked/setStreak 에 전달 */
export const currentPrivateGen = (): number => privateGen

export const useTradingGameStore = create<TradingGameState>()((set, get) => {
  const pushNudges = (nudges: Nudge[]) => {
    for (const n of nudges) get().pushToast({ kind: 'nudge', icon: NUDGE_ICON[n.type] ?? '💬', message: n.message })
  }

  /** 거래·자동청산 후 계좌/포지션/순위 재조회. 개별 실패는 무시(다음 갱신에서 회복) */
  const refreshTrading = async () => {
    const season = get().season
    if (!season) return
    const gen = privateGen
    const seq = ++refreshSeq
    const [acc, pos, rank] = await Promise.allSettled([
      gameApi.getMyAccount(season.id),
      gameApi.getActivePosition(season.id),
      gameApi.getMyRank(season.id),
    ])
    if (gen !== privateGen || seq !== refreshSeq) return // 로그아웃 또는 더 최신 재조회 존재 — 덮어쓰기 금지
    const patch: Partial<PrivateState> = {}
    if (acc.status === 'fulfilled') patch.account = acc.value
    if (pos.status === 'fulfilled') patch.position = pos.value
    if (rank.status === 'fulfilled') patch.myRank = rank.value
    set(patch)
  }

  /** 연속 출석 재조회(주문 성공 시 서버가 touch). 실패는 무시 */
  const refreshStreak = async () => {
    const gen = privateGen
    try {
      const streak = await gameApi.getMyStreak()
      if (gen === privateGen) set({ streak })
    } catch {
      // Streak 은 부가 정보 — 조회 실패 시 기존 값 유지
    }
  }

  return {
    ...PRIVATE_EMPTY,
    status: 'loading',
    season: null,
    submitting: false,
    closing: false,
    toasts: [],
    quizDisabled: false,

    loadSeason: async () => {
      if (!gameClient) {
        set({ status: 'unavailable' })
        return
      }
      // 최초 로드만 loading 표시 — 시즌이 이미 있으면(탭 재진입) 화면 유지한 채 백그라운드 갱신
      if (get().season === null) set({ status: 'loading' })
      try {
        const season = await gameApi.getActiveSeason()
        set(season ? { status: 'ready', season } : { status: 'no-season', season: null })
      } catch {
        if (get().status !== 'ready') set({ status: 'error' }) // 이미 ready 면 현재 상태 유지
      }
    },

    loadPrivate: async () => {
      const season = get().season
      if (!season) return
      const gen = privateGen
      const [, coach, academy, streak] = await Promise.allSettled([
        refreshTrading(),
        gameApi.getTodayCoach(),
        gameApi.getAcademyUnlocked(),
        gameApi.getMyStreak(),
      ])
      const patch: Partial<PrivateState> = {}
      if (coach.status === 'fulfilled') {
        patch.coach = coach.value && coach.value.season_id === season.id ? coach.value : null
      }
      if (academy.status === 'fulfilled') patch.academyUnlocked = academy.value
      if (streak.status === 'fulfilled') patch.streak = streak.value
      if (gen !== privateGen) return // 로그아웃 후 늦게 도착한 이전 사용자 데이터 폐기
      set(patch)
    },

    refreshTrading,

    refreshRank: async () => {
      const season = get().season
      if (!season) return
      const gen = privateGen
      const seq = refreshSeq
      try {
        const rank = await gameApi.getMyRank(season.id)
        if (gen !== privateGen || seq !== refreshSeq) return // 로그아웃 또는 폴링 중 재조회 시작 — 덮어쓰기 금지
        set({ myRank: rank })
      } catch {
        // 순위 갱신 실패는 조용히 무시(다음 주기에 재시도)
      }
    },

    refreshStreak,

    resetPrivate: () => {
      privateGen++
      set({ ...PRIVATE_EMPTY })
    },

    placeOrder: async (side, ratio, leverage) => {
      const { season, submitting } = get()
      if (!season || submitting) return
      const gen = privateGen
      set({ submitting: true })
      try {
        const result = await gameApi.placeOrder({ season_id: season.id, side, ratio, leverage })
        if (gen === privateGen) {
          set({ position: result.position })
          pushNudges(result.nudges)
          void refreshStreak() // 서버가 주문 시 연속 출석을 touch — 기다리지 않음
          await refreshTrading()
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
      } finally {
        set({ submitting: false })
      }
    },

    closePosition: async () => {
      const { position, closing } = get()
      if (!position || closing) return
      const gen = privateGen
      set({ closing: true })
      try {
        const result = await gameApi.closePosition(position.id)
        if (gen === privateGen) {
          set({ position: null })
          pushNudges(result.nudges)
          await refreshTrading()
        }
      } catch (err) {
        get().pushToast({ kind: 'error', icon: '⚠️', message: orderErrorMessage(err) })
        void refreshTrading() // 이미 자동청산된 경우 등 — 서버 상태로 동기화
      } finally {
        set({ closing: false })
      }
    },

    applyMessage: (msg) => {
      const { season, position } = get()
      switch (msg.type) {
        case 'tick':
          if (season && msg.ticker === season.ticker) set({ lastPrice: msg.price })
          return
        case 'position_pnl':
          if (position && position.id === msg.position_id) {
            set({ position: { ...position, roi_pct: msg.roi_pct, pnl_amount: msg.pnl_amount } })
          }
          return
        case 'sentiment':
          set({ sentiment: { long_pct: msg.long_pct, short_pct: msg.short_pct } })
          return
        case 'nudge':
          pushNudges([msg.nudge])
          void refreshTrading() // 자동청산(손절/익절/마진콜) 반영
          return
        case 'coach':
          if (season && msg.coach.season_id === season.id) set({ coach: msg.coach })
          return
      }
    },

    setAcademyUnlocked: (unlocked, gen) => {
      if (gen === privateGen) set({ academyUnlocked: unlocked })
    },

    setStreak: (streak, gen) => {
      if (gen === privateGen) set({ streak })
    },

    markQuizDisabled: () => set({ quizDisabled: true }),

    pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }] })),
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})
```

- [ ] **Step 2: 검증** — 공통 web_client 검증 명령. 기대: 통과(기존 `GamePage`는 새 필드를 아직 쓰지 않음).

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/store/tradingGame.ts
git commit -m "feat(web): 게임 스토어 — Streak·퀴즈 비활성·아카데미 해금 반영(privateGen 가드)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 3: 공용 Modal + 랭킹 모달

**Files:** Create `web_client/src/components/ui/Modal.tsx`, `web_client/src/components/game/LeaderboardModal.tsx`

설계 메모:
- `Modal`은 `open` prop 없이 **부모가 열 때만 마운트**한다(닫힘 = 언마운트 → 모달 로컬 state·타이머가 자동 폐기, 스펙 "닫히면 버림").
- z-index: `LoginModal`=z-50, 게임 토스트(`NudgeToaster`)=z-40. 모달은 **z-40** 이고 `GamePage`에서 `NudgeToaster`보다 먼저 렌더 → 같은 z 에서 DOM 뒤쪽인 토스트가 모달 위에 보인다("보상을 받았어요" 토스트가 오버레이에 가리지 않음). 헤더(`Layout` sticky z-30)보다는 위.
- 모바일 하단 시트(`items-end` + `rounded-t-card`), `sm` 이상 중앙(`sm:items-center` + `sm:rounded-card`). `rounded-t-card`는 기존 `borderRadius.card` 토큰에서 Tailwind 가 생성.

- [ ] **Step 1: `src/components/ui/Modal.tsx` 생성**

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
}

// 공용 모달 — 부모가 열 때만 마운트한다(닫으면 언마운트 → 내부 state·타이머 자동 정리).
// 모바일: 하단 시트 / sm 이상: 중앙. ESC·바깥 클릭으로 닫힘. 열린 동안 body 스크롤 잠금.
// z-40: 로그인 모달(z-50)보다 아래, 게임 토스트(z-40)는 DOM 상 뒤에 렌더돼 모달 위에 보인다.
export default function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full flex-col rounded-t-card bg-white shadow-xl outline-none sm:max-w-lg sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `src/components/game/LeaderboardModal.tsx` 생성**

```tsx
import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { chipClass } from '../ui/Chip'
import Modal from '../ui/Modal'
import { getHallOfFame, getLeaderboard } from '../../api/game'
import { formatPct, pnlClass } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import type { HallOfFameRow, LeaderboardRow } from '../../types/game'

type Tab = 'season' | 'hof'
type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

interface LeaderboardModalProps {
  seasonId: number
  /** 로그인 유저 id(비로그인 null) — 내 행 강조용 */
  myUserId: number | null
  onClose: () => void
}

/** 승률은 0~100 부호 없는 퍼센트(formatPct 는 + 부호를 붙이므로 쓰지 않는다) */
const winRate = (n: number): string => `${n.toFixed(1)}%`

/** 명예의 전당 행(시즌 desc · 순위 asc 정렬 유지)을 시즌별로 묶는다 */
function groupBySeason(rows: HallOfFameRow[]): { seasonId: number; rows: HallOfFameRow[] }[] {
  const groups: { seasonId: number; rows: HallOfFameRow[] }[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.seasonId === r.season_id) last.rows.push(r)
    else groups.push({ seasonId: r.season_id, rows: [r] })
  }
  return groups
}

// 랭킹 모달 — 시즌 Top 100 / 명예의 전당(MBTI). 공개 API 라 비로그인도 열람. 열릴 때·탭 전환 시 활성 탭만 로드.
export default function LeaderboardModal({ seasonId, myUserId, onClose }: LeaderboardModalProps) {
  const [tab, setTab] = useState<Tab>('season')
  const [board, setBoard] = useState<Load<LeaderboardRow[]>>({ kind: 'loading' })
  const [hof, setHof] = useState<Load<HallOfFameRow[]>>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (tab === 'season') {
      setBoard({ kind: 'loading' })
      getLeaderboard(seasonId)
        .then((data) => {
          if (!cancelled) setBoard({ kind: 'ok', data })
        })
        .catch((err: unknown) => {
          if (!cancelled) setBoard({ kind: 'error', message: gameErrorMessage(err) })
        })
    } else {
      setHof({ kind: 'loading' })
      getHallOfFame()
        .then((data) => {
          if (!cancelled) setHof({ kind: 'ok', data })
        })
        .catch((err: unknown) => {
          if (!cancelled) setHof({ kind: 'error', message: gameErrorMessage(err) })
        })
    }
    return () => {
      cancelled = true
    }
  }, [tab, seasonId, reloadKey])

  const current = tab === 'season' ? board : hof

  return (
    <Modal title="🏆 랭킹" onClose={onClose}>
      <div className="mb-4 flex gap-2" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'season'} onClick={() => setTab('season')} className={chipClass(tab === 'season')}>
          시즌 랭킹
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hof'} onClick={() => setTab('hof')} className={chipClass(tab === 'hof')}>
          명예의 전당
        </button>
      </div>

      {current.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {current.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{current.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}

      {tab === 'season' && board.kind === 'ok' && (
        board.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">아직 순위가 없어요</p>
        ) : (
          <ol className="space-y-1">
            {board.data.map((r) => {
              const mine = myUserId !== null && r.user_id === myUserId
              return (
                <li
                  key={r.user_id}
                  className={`flex items-center gap-3 rounded-field px-3 py-2 text-sm ${mine ? 'bg-brand-soft' : ''}`}
                >
                  <span className="w-8 shrink-0 font-bold tabular-nums text-ink">{r.rank}</span>
                  <span className="flex-1 truncate text-ink">
                    {r.nickname ?? '익명'}
                    {mine && <span className="ml-1 text-xs font-semibold text-brand">나</span>}
                  </span>
                  <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.roi_pct)}`}>
                    {formatPct(r.roi_pct)}
                  </span>
                  <span className="w-20 text-right text-xs text-ink-muted tabular-nums">승률 {winRate(r.win_rate)}</span>
                </li>
              )
            })}
          </ol>
        )
      )}

      {tab === 'hof' && hof.kind === 'ok' && (
        hof.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">아직 명예의 전당이 비어 있어요</p>
        ) : (
          <div className="space-y-5">
            {groupBySeason(hof.data).map((g) => (
              <section key={g.seasonId}>
                {/* API 가 시즌 번호 없이 season_id 만 준다 — id 를 시즌 표기로 사용 */}
                <h3 className="mb-2 text-sm font-bold text-ink">시즌 {g.seasonId}</h3>
                <ol className="space-y-1">
                  {g.rows.map((r) => (
                    <li key={r.rank} className="flex items-center gap-3 rounded-field px-3 py-2 text-sm">
                      <span className="w-8 shrink-0 font-bold tabular-nums text-ink">{r.rank}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-ink">{r.nickname}</span>
                        {r.trading_mbti && (
                          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                            {r.trading_mbti}
                          </span>
                        )}
                      </span>
                      <span className={`w-16 text-right font-semibold tabular-nums ${pnlClass(r.final_roi)}`}>
                        {formatPct(r.final_roi)}
                      </span>
                      <span className="w-20 text-right text-xs text-ink-muted tabular-nums">승률 {winRate(r.win_rate)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )
      )}
    </Modal>
  )
}
```

- [ ] **Step 3: 검증** — 공통 web_client 검증 명령. 기대: 통과(아직 어디서도 import 하지 않음 — tsc 는 `src` 전체를 검사).

- [ ] **Step 4: 커밋**

```bash
git add web_client/src/components/ui/Modal.tsx web_client/src/components/game/LeaderboardModal.tsx
git commit -m "feat(web): 공용 Modal + 랭킹 모달(시즌 Top 100·명예의 전당 MBTI)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 4: 퀘스트 모달

**Files:** Create `web_client/src/components/game/QuestModal.tsx`

설계 메모: 수령 성공 → 해당 카드 교체 + 응답 `badge`가 있고 목록에 없으면 추가 + (요청 시작 시 `gen`과 현재 `gen`이 같을 때만) `refreshTrading()`·토스트 "보상을 받았어요". 실패 → `gameErrorMessage` 토스트. 동시에 하나만 수령(`claiming`).

- [ ] **Step 1: `src/components/game/QuestModal.tsx` 생성**

```tsx
import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Chip from '../ui/Chip'
import Modal from '../ui/Modal'
import { claimQuest, getQuests } from '../../api/game'
import { formatKrw } from '../../lib/format'
import { gameErrorMessage } from '../../lib/gameErrors'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { Quest, QuestList } from '../../types/game'

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

function rewardLabel(q: Quest): string {
  if (q.reward_cash !== null) return `+${formatKrw(q.reward_cash)}`
  if (q.reward_badge !== null) return '🏅 뱃지'
  return ''
}

interface QuestCardProps {
  quest: Quest
  claiming: boolean
  onClaim: () => void
}

function QuestCard({ quest, claiming, onClaim }: QuestCardProps) {
  const done = Math.min(quest.progress, quest.target)
  const pct = quest.target > 0 ? (done / quest.target) * 100 : 0
  return (
    <Card as="article">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{quest.title}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{quest.description}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-up">{rewardLabel(quest)}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={quest.target}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-xs text-ink-muted tabular-nums">
          {done}/{quest.target}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        {quest.claimed ? (
          <Button variant="secondary" disabled>
            받음 ✓
          </Button>
        ) : quest.completed ? (
          <Button loading={claiming} loadingText="받는 중…" onClick={onClaim}>
            보상 받기
          </Button>
        ) : (
          <Button variant="secondary" disabled>
            진행 중
          </Button>
        )}
      </div>
    </Card>
  )
}

// 퀘스트 모달 — Q1~Q3 진행률·보상 수령·보유 뱃지. 로그인 전용(GamePage 가 비로그인 시 LoginModal 로 분기).
export default function QuestModal({ onClose }: { onClose: () => void }) {
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [state, setState] = useState<Load<QuestList>>({ kind: 'loading' })
  const [claiming, setClaiming] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    getQuests()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ok', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const claim = async (code: string) => {
    if (claiming !== null) return
    const gen = currentPrivateGen()
    setClaiming(code)
    try {
      const res = await claimQuest(code)
      setState((s) => {
        if (s.kind !== 'ok') return s
        const quests = s.data.quests.map((q) => (q.code === res.quest.code ? res.quest : q))
        const badge = res.badge
        const badges = badge && !s.data.badges.some((b) => b.code === badge.code) ? [...s.data.badges, badge] : s.data.badges
        return { kind: 'ok', data: { quests, badges } }
      })
      if (gen === currentPrivateGen()) {
        void refreshTrading() // 현금 보상 → 헤더 자본금 반영
        pushToast({ kind: 'info', icon: '🎁', message: '보상을 받았어요' })
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) })
    } finally {
      setClaiming(null)
    }
  }

  return (
    <Modal title="🎯 퀘스트" onClose={onClose}>
      {state.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{state.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}
      {state.kind === 'ok' && (
        <div className="space-y-3">
          {state.data.quests.map((q) => (
            <QuestCard key={q.code} quest={q} claiming={claiming === q.code} onClaim={() => void claim(q.code)} />
          ))}
          {state.data.badges.length > 0 && (
            <div className="pt-2">
              <p className="mb-2 text-sm font-semibold text-ink">보유 뱃지</p>
              <div className="flex flex-wrap gap-2">
                {state.data.badges.map((b) => (
                  <Chip key={b.code} active>
                    🏅 {b.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/components/game/QuestModal.tsx
git commit -m "feat(web): 퀘스트 모달 — 진행률·보상 수령·보유 뱃지

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 5: 아카데미 모달

**Files:** Create `web_client/src/components/game/AcademyModal.tsx`

설계 메모: 로드 응답 `unlocked=true` → "🔓 5배 레버리지가 해금됐어요" 안내만(+ 스토어 동기화). 미해금 → 문항별 라디오, 모든 문항 선택 시 `[제출]` 활성 → 문항별 ✅/❌·정답·해설. 응답 `unlocked=true` → `setAcademyUnlocked(true, gen)` + 토스트(5x 칩이 즉시 🔓), 아니면 `[다시 도전]`(선택·결과 초기화).

- [ ] **Step 1: `src/components/game/AcademyModal.tsx` 생성**

```tsx
import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Modal from '../ui/Modal'
import { getAcademyQuiz, submitAcademy } from '../../api/game'
import { gameErrorMessage } from '../../lib/gameErrors'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { AcademyQuiz, AcademySubmitResult } from '../../types/game'

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T }

// 아카데미 모달 — 리스크 관리 3문항. 모두 맞히면 5배 레버리지 해금(재응시 무제한). 로그인 전용.
export default function AcademyModal({ onClose }: { onClose: () => void }) {
  const setAcademyUnlocked = useTradingGameStore((s) => s.setAcademyUnlocked)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [state, setState] = useState<Load<AcademyQuiz>>({ kind: 'loading' })
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [result, setResult] = useState<AcademySubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const gen = currentPrivateGen()
    setState({ kind: 'loading' })
    getAcademyQuiz()
      .then((data) => {
        if (cancelled) return
        setState({ kind: 'ok', data })
        if (data.unlocked) setAcademyUnlocked(true, gen) // 다른 기기에서 해금한 경우 동기화
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: gameErrorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, setAcademyUnlocked])

  const submit = async () => {
    if (submitting) return
    const gen = currentPrivateGen()
    setSubmitting(true)
    try {
      const res = await submitAcademy(answers)
      setResult(res)
      if (res.unlocked) {
        setAcademyUnlocked(true, gen)
        pushToast({ kind: 'info', icon: '🔓', message: '5배 레버리지가 해금됐어요' })
      }
    } catch (err) {
      pushToast({ kind: 'error', icon: '⚠️', message: gameErrorMessage(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
  }

  return (
    <Modal title="🎓 아카데미" onClose={onClose}>
      {state.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">불러오는 중…</p>}
      {state.kind === 'error' && (
        <div className="py-10 text-center">
          <p className="text-sm text-ink-muted">{state.message}</p>
          <Button variant="secondary" className="mt-3" onClick={() => setReloadKey((k) => k + 1)}>
            다시 시도
          </Button>
        </div>
      )}
      {state.kind === 'ok' && state.data.unlocked && result === null && (
        <p className="py-10 text-center font-semibold text-ink">🔓 5배 레버리지가 해금됐어요</p>
      )}
      {state.kind === 'ok' && (!state.data.unlocked || result !== null) && (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">세 문제를 모두 맞히면 5배 레버리지가 열려요.</p>
          {state.data.questions.map((q, qi) => {
            const r = result?.results.find((x) => x.id === q.id) ?? null
            return (
              <Card key={q.id} as="fieldset">
                <legend className="sr-only">문항 {qi + 1}</legend>
                <p className="font-semibold text-ink">
                  {qi + 1}. {q.question}
                  {r && <span className="ml-1">{r.correct ? '✅' : '❌'}</span>}
                </p>
                <div className="mt-2 space-y-1.5">
                  {q.choices.map((c, ci) => (
                    <label key={ci} className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                      <input
                        type="radio"
                        name={`academy-${q.id}`}
                        className="mt-1"
                        checked={answers[q.id] === ci}
                        disabled={result !== null || submitting}
                        onChange={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
                {r && (
                  <div className="mt-3 rounded-field bg-white p-3 text-sm">
                    <p className="font-semibold text-ink">정답: {q.choices[r.answer] ?? '—'}</p>
                    <p className="mt-1 text-ink-muted">{r.explanation}</p>
                  </div>
                )}
              </Card>
            )
          })}
          {result === null ? (
            <Button
              full
              disabled={state.data.questions.some((q) => answers[q.id] === undefined)}
              loading={submitting}
              loadingText="채점 중…"
              onClick={() => void submit()}
            >
              제출
            </Button>
          ) : result.unlocked ? (
            <p className="text-center font-semibold text-brand">🔓 5배 레버리지가 해금됐어요</p>
          ) : (
            <Button full variant="secondary" onClick={retry}>
              다시 도전
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 2: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 3: 커밋**

```bash
git add web_client/src/components/game/AcademyModal.tsx
git commit -m "feat(web): 아카데미 모달 — 3문항 채점·5배 레버리지 해금

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 6: 야간 10초 차트 퀴즈 — 미니 차트 · 모달 · 배너

**Files:** Create `web_client/src/components/game/QuizMiniChart.tsx`, `web_client/src/components/game/ChartQuizModal.tsx`, `web_client/src/components/game/QuizBanner.tsx`

설계 메모(경쟁 상태):
- `startedAt`은 **출제 응답 도착 시각**(서버 `served_at`보다 늦음 → 서버 유예 3초가 네트워크 지연 흡수).
- `quizSecondsLeft`는 올림 — 시작 순간 10, 정확히 10초 경과 시 0.
- 카운트다운 interval(200ms)은 `playing` 동안만 존재, 단계 변경·언마운트 시 정리. 0초 → **`playing`에서만** 로컬 시간 초과(`result: null`)로 전환(`submitting` 중 0초는 무시).
- 선택은 0초 전까지만, 선택 즉시 제출. `busyRef`로 리렌더 전 연타·시작/제출 중복 방지.
- `aliveRef`(StrictMode 이중 마운트 대응 — effect 본문에서 true 재설정)로 언마운트 후 늦은 응답이 단계 전환·`onClose`를 호출하지 않게 한다. 스토어 반영(`setStreak`/`refreshTrading`)은 `gen` 가드로 판단(모달이 닫혀도 같은 사용자면 반영).
- 503 `FEATURE_DISABLED`는 출제·제출 어느 쪽에서 와도 `markQuizDisabled()` + 토스트 + 모달 닫기. 404 `NO_QUIZ_AVAILABLE` → "준비된 문제를 모두 풀었어요"(재시도 버튼 없음).
- 해설(`explanation`)은 마크다운 원문이지만 6a `CoachBanner`와 같이 `whitespace-pre-line` 텍스트로 표시(마크다운 렌더러 미도입).

- [ ] **Step 1: `src/components/game/QuizMiniChart.tsx` 생성**

```tsx
import { useEffect, useRef } from 'react'
import { CrosshairMode, createChart, type UTCTimestamp } from 'lightweight-charts'
import type { QuizCandle } from '../../types/game'

// 퀴즈용 미니 캔들 차트 — 날짜를 숨기므로 시간축은 순번(1..N), 가격은 서버 정규화 값(첫 종가=100).
// 시간축·크로스헤어 라벨을 숨기고 스크롤/확대를 막아 "차트 모양"만 보이게 한다.
const UP = '#f04452'
const DOWN = '#3182f6'

/** 순번 → 차트 시간값. UTCTimestamp 는 number 브랜드 타입이라 생성 함수가 없어 단언이 유일한 방법이다 */
const seqTime = (i: number): UTCTimestamp => (i + 1) as UTCTimestamp

export default function QuizMiniChart({ candles }: { candles: QuizCandle[] }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const chart = createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b95a1' },
      grid: { vertLines: { visible: false }, horzLines: { color: '#f2f4f6' } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { labelVisible: false },
        horzLine: { labelVisible: false },
      },
      rightPriceScale: { borderColor: '#e5e8eb' },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p: number) => p.toFixed(1) },
    })
    const series = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    })
    series.setData(candles.map((c, i) => ({ time: seqTime(i), open: c.open, high: c.high, low: c.low, close: c.close })))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [candles])

  return <div ref={boxRef} className="h-[220px] w-full overflow-hidden rounded-card border border-line bg-white" />
}
```

- [ ] **Step 2: `src/components/game/ChartQuizModal.tsx` 생성**

```tsx
import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import QuizMiniChart from './QuizMiniChart'
import { getRandomQuiz, submitQuiz } from '../../api/game'
import { formatKrw, formatPct, pnlClass } from '../../lib/format'
import { apiErrorCode, gameErrorMessage } from '../../lib/gameErrors'
import { quizSecondsLeft } from '../../lib/quiz'
import { currentPrivateGen, useTradingGameStore } from '../../store/tradingGame'
import type { QuizChoice, QuizQuestion, QuizResult } from '../../types/game'

const TICK_MS = 200

// result === null → 0초까지 고르지 않아 제출하지 않은 로컬 시간 초과(정답 미공개)
type Phase =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'playing'; quiz: QuizQuestion; startedAt: number }
  | { kind: 'submitting'; quiz: QuizQuestion; choice: QuizChoice }
  | { kind: 'result'; result: QuizResult | null; choice: QuizChoice | null }
  | { kind: 'error'; message: string; retryable: boolean }

const choiceLabel = (c: QuizChoice): string => (c === 'UP' ? '📈 상승' : '📉 하락')

function rewardLine(r: QuizResult): string | null {
  if (r.rewarded) return `+${formatKrw(r.reward_cash)} 지급`
  if (r.timed_out) return '시간 초과로 보상 없음'
  if (r.correct) return '오늘 보상 한도(3회)를 채웠어요'
  return null
}

// 야간 10초 차트 퀴즈 — intro → loading → playing → submitting → result (오류 시 error).
// 판정은 서버 시각 기준(10초 + 유예 3초). 프론트 카운트다운은 연출이며 0초가 되면 제출하지 않고 시간 초과 처리.
export default function ChartQuizModal({ onClose }: { onClose: () => void }) {
  const markQuizDisabled = useTradingGameStore((s) => s.markQuizDisabled)
  const setStreak = useTradingGameStore((s) => s.setStreak)
  const refreshTrading = useTradingGameStore((s) => s.refreshTrading)
  const pushToast = useTradingGameStore((s) => s.pushToast)
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' })
  const [now, setNow] = useState(() => Date.now())
  const aliveRef = useRef(true) // 언마운트 후 늦은 응답이 화면 전환·onClose 를 부르지 않도록
  const busyRef = useRef(false) // 시작/제출 중복 클릭 방지(리렌더 전 연타 대비)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // 카운트다운 — playing 동안만 200ms 간격 갱신. 단계가 바뀌거나 언마운트되면 정리
  const playing = phase.kind === 'playing'
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [playing])

  const secondsLeft = phase.kind === 'playing' ? quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, now) : 0

  // 0초 도달(미선택) → 서버에 제출하지 않고 로컬 시간 초과. playing 에서만 전환(submitting 중엔 무시)
  useEffect(() => {
    if (phase.kind === 'playing' && secondsLeft === 0) setPhase({ kind: 'result', result: null, choice: null })
  }, [phase, secondsLeft])

  const handleError = (err: unknown) => {
    const code = apiErrorCode(err)
    if (code === 'FEATURE_DISABLED') {
      markQuizDisabled()
      pushToast({ kind: 'info', icon: '🧩', message: gameErrorMessage(err) })
      if (aliveRef.current) onClose()
      return
    }
    if (aliveRef.current) {
      setPhase({ kind: 'error', message: gameErrorMessage(err), retryable: code !== 'NO_QUIZ_AVAILABLE' })
    }
  }

  const start = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase({ kind: 'loading' })
    try {
      const quiz = await getRandomQuiz()
      if (!aliveRef.current) return
      const t = Date.now() // 응답 도착 시점부터 카운트(서버 served_at 보다 늦게 시작 — 유예 3초가 흡수)
      setNow(t)
      setPhase({ kind: 'playing', quiz, startedAt: t })
    } catch (err) {
      handleError(err)
    } finally {
      busyRef.current = false
    }
  }

  const choose = async (choice: QuizChoice) => {
    if (phase.kind !== 'playing' || busyRef.current) return
    if (quizSecondsLeft(phase.startedAt, phase.quiz.time_limit_sec, Date.now()) === 0) return
    busyRef.current = true
    const quiz = phase.quiz
    const gen = currentPrivateGen()
    setPhase({ kind: 'submitting', quiz, choice })
    try {
      const result = await submitQuiz(quiz.id, choice)
      if (result.streak) setStreak(result.streak, gen)
      if (result.rewarded && gen === currentPrivateGen()) void refreshTrading() // 보상 → 헤더 자본금 반영
      if (aliveRef.current) setPhase({ kind: 'result', result, choice })
    } catch (err) {
      handleError(err)
    } finally {
      busyRef.current = false
    }
  }

  const footer = (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <Button onClick={() => void start()}>다음 문제</Button>
      <Button variant="secondary" onClick={onClose}>
        닫기
      </Button>
    </div>
  )

  return (
    <Modal title="🧩 야간 10초 차트 퀴즈" onClose={onClose}>
      {phase.kind === 'intro' && (
        <div>
          <ul className="space-y-2 text-sm text-ink">
            <li>📊 날짜·종목을 가린 차트를 보고 5거래일 뒤 주가 방향을 맞혀요.</li>
            <li>⏱ 제한 시간은 10초. 시간 안에 고르지 않으면 제출되지 않아요.</li>
            <li>🎁 정답이면 +₩200,000 (보상은 하루 3회까지).</li>
          </ul>
          <Button full className="mt-5" onClick={() => void start()}>
            시작
          </Button>
        </div>
      )}

      {phase.kind === 'loading' && <p className="py-10 text-center text-sm text-ink-muted">문제를 불러오는 중…</p>}

      {(phase.kind === 'playing' || phase.kind === 'submitting') && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold text-ink">5거래일 뒤 주가는?</p>
            {phase.kind === 'playing' ? (
              <span
                className={`text-lg font-bold tabular-nums ${secondsLeft <= 3 ? 'text-up' : 'text-ink'}`}
                aria-live="polite"
              >
                ⏱ {secondsLeft}초
              </span>
            ) : (
              <span className="text-sm text-ink-muted">채점 중…</span>
            )}
          </div>
          <QuizMiniChart candles={phase.quiz.chart_snapshot} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={phase.kind !== 'playing'}
              onClick={() => void choose('UP')}
              className="h-14 rounded-btn bg-up text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              오를까? 📈
            </button>
            <button
              type="button"
              disabled={phase.kind !== 'playing'}
              onClick={() => void choose('DOWN')}
              className="h-14 rounded-btn bg-down text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              내릴까? 📉
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'result' && phase.result === null && (
        <div>
          <p className="py-4 text-center text-2xl font-bold text-ink">⏰ 시간 초과</p>
          <p className="text-center text-sm text-ink-muted">선택하지 않아 제출되지 않았어요. 정답은 공개되지 않아요.</p>
          {footer}
        </div>
      )}

      {phase.kind === 'result' && phase.result !== null && (
        <div>
          <p className={`py-4 text-center text-2xl font-bold ${phase.result.correct ? 'text-up' : 'text-ink'}`}>
            {phase.result.correct ? '⭕ 정답이에요!' : phase.result.timed_out ? '⏰ 시간 초과' : '❌ 아쉽게 틀렸어요'}
          </p>
          <div className="space-y-1.5 text-sm text-ink">
            <p>
              정답 {choiceLabel(phase.result.answer)}
              {phase.choice !== null && <span className="text-ink-muted"> · 내 선택 {choiceLabel(phase.choice)}</span>}
            </p>
            <p>
              실제 5일 등락{' '}
              <span className={`font-semibold ${pnlClass(phase.result.actual_change)}`}>
                {formatPct(phase.result.actual_change)}
              </span>
            </p>
            <p>패턴 {phase.result.pattern_type}</p>
            {rewardLine(phase.result) !== null && (
              <p className={phase.result.rewarded ? 'font-semibold text-up' : 'text-ink-muted'}>{rewardLine(phase.result)}</p>
            )}
          </div>
          <p className="mt-3 whitespace-pre-line rounded-field bg-surface p-3 text-sm text-ink">{phase.result.explanation}</p>
          <p className="mt-2 text-xs text-ink-muted">
            종목 {phase.result.ticker} · 기준일 {phase.result.base_date}
          </p>
          {footer}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="py-6 text-center">
          <p className="text-sm text-ink">{phase.message}</p>
          <div className="mt-5 flex justify-center gap-3">
            {phase.retryable && <Button onClick={() => void start()}>다시 시도</Button>}
            <Button variant="secondary" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 3: `src/components/game/QuizBanner.tsx` 생성**

```tsx
// 장 마감 후(KST 15:30~24:00)·주말 강조 배너 — 클릭 시 야간 차트 퀴즈 모달.
export default function QuizBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-card bg-brand-soft px-4 py-3 text-left transition hover:brightness-95"
    >
      <span>
        <span className="block text-sm font-bold text-brand">🧩 야간 10초 차트 퀴즈 도전!</span>
        <span className="mt-0.5 block text-xs text-ink-muted">차트만 보고 5일 뒤 방향을 맞혀 보세요</span>
      </span>
      <span className="text-brand">›</span>
    </button>
  )
}
```

- [ ] **Step 4: 검증** — 공통 web_client 검증 명령. 기대: 통과.

- [ ] **Step 5: 커밋**

```bash
git add web_client/src/components/game/QuizMiniChart.tsx web_client/src/components/game/ChartQuizModal.tsx web_client/src/components/game/QuizBanner.tsx
git commit -m "feat(web): 야간 10초 차트 퀴즈 — 미니 차트·카운트다운·결과/보상, 장 마감 후 배너

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 7: 헤더 · 게임 페이지 연결

**Files:** Modify `web_client/src/components/game/GameHeader.tsx`(전체 교체), `web_client/src/pages/GamePage.tsx`(전체 교체)

변경 요지:
- `GameHeader`: 비활성 버튼 2개 → 활성(`onOpenRanking`/`onOpenQuest`), `showQuiz`일 때 `🧩 퀴즈`, `loggedIn && streak.enabled && current_streak ≥ 1`일 때 `🔥 n일 연속` 칩(title `최고 기록 n일`). 기존 순위/자본금 표시는 그대로.
- `GamePage`: `activeModal: 'ranking' | 'quest' | 'academy' | 'quiz' | null`. 랭킹은 비로그인도 열람, 퀘스트·아카데미·퀴즈는 비로그인 시 `LoginModal`. 로그아웃되면 로그인 전용 모달 닫기. 5x 🔒 칩(`onLockedLeverage`) → 아카데미 모달(6a 안내 토스트 대체). 퀴즈 배너는 `isQuizPrimeTime && !quizDisabled`일 때 주문 패널 위(1분마다 재판정). 모달들은 `NudgeToaster`보다 먼저 렌더. 6a의 상태 분기·순위 폴링·WS 훅·주문 핸들러는 그대로. 새 훅은 모두 조기 return 앞에 둔다.

- [ ] **Step 1: `src/components/game/GameHeader.tsx` 전체 교체**

```tsx
import Card from '../ui/Card'
import { daysUntil, formatKrw, formatPct, pnlClass } from '../../lib/format'
import type { Account, MyRank, Season, Streak } from '../../types/game'

interface GameHeaderProps {
  season: Season
  account: Account | null
  myRank: MyRank | null
  loggedIn: boolean
  streak: Streak | null
  /** 퀴즈 진입 버튼 노출(서버가 퀴즈 기능을 끈 경우 false) */
  showQuiz: boolean
  onOpenRanking: () => void
  onOpenQuest: () => void
  onOpenQuiz: () => void
}

const NAV_BUTTON = 'rounded-field bg-white px-3 py-1.5 text-sm text-ink transition hover:bg-line'

// 시즌·종목·D-day + Streak + 내 순위/수익률 + 자본금 + 랭킹·퀘스트·퀴즈 진입 버튼.
export default function GameHeader({
  season, account, myRank, loggedIn, streak, showQuiz, onOpenRanking, onOpenQuest, onOpenQuiz,
}: GameHeaderProps) {
  const dday = daysUntil(season.end_at)
  const rank = myRank?.rank ?? null
  const roi = myRank?.roi_pct ?? null
  const showStreak = loggedIn && streak !== null && streak.enabled && streak.current_streak >= 1

  return (
    <Card className="sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-brand">
            <span>
              시즌 {season.season_number}기{dday !== null && ` · 종료 D-${dday}`}
            </span>
            {showStreak && (
              <span
                className="rounded-full bg-white px-2 py-0.5 text-up"
                title={`최고 기록 ${streak.highest_streak}일`}
              >
                🔥 {streak.current_streak}일 연속
              </span>
            )}
          </p>
          <h1 className="mt-0.5 text-lg font-bold text-ink">
            {season.stock_name} <span className="text-sm font-medium text-ink-muted">({season.ticker})</span>
          </h1>
        </div>
        <div className="text-right text-sm">
          {!loggedIn ? (
            <p className="text-ink-muted">로그인하고 시즌에 참여하세요</p>
          ) : rank !== null ? (
            <p className="font-semibold text-ink">
              내 순위 {rank}위
              {roi !== null && <span className={`ml-1 ${pnlClass(roi)}`}>{formatPct(roi)}</span>}
            </p>
          ) : (
            <p className="text-ink-muted">첫 거래 후 순위가 집계돼요</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          자본금
          <span className="ml-1.5 text-base font-bold text-ink tabular-nums">
            {account ? formatKrw(account.total_asset) : '—'}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenRanking} className={NAV_BUTTON}>
            🏆 랭킹
          </button>
          <button type="button" onClick={onOpenQuest} className={NAV_BUTTON}>
            🎯 퀘스트
          </button>
          {showQuiz && (
            <button type="button" onClick={onOpenQuiz} className={NAV_BUTTON}>
              🧩 퀴즈
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: `src/pages/GamePage.tsx` 전체 교체**

```tsx
import { useEffect, useState } from 'react'
import LoginModal from '../components/LoginModal'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import AcademyModal from '../components/game/AcademyModal'
import ActivePositionCard from '../components/game/ActivePositionCard'
import ChartQuizModal from '../components/game/ChartQuizModal'
import CoachBanner from '../components/game/CoachBanner'
import GameHeader from '../components/game/GameHeader'
import LeaderboardModal from '../components/game/LeaderboardModal'
import NudgeToaster from '../components/game/NudgeToaster'
import OrderPanel from '../components/game/OrderPanel'
import QuestModal from '../components/game/QuestModal'
import QuizBanner from '../components/game/QuizBanner'
import SentimentBar from '../components/game/SentimentBar'
import TradingChart from '../components/game/TradingChart'
import { useGameWebSocket } from '../hooks/useGameWebSocket'
import { isQuizPrimeTime } from '../lib/quiz'
import { useAuthStore } from '../store/auth'
import { useTradingGameStore } from '../store/tradingGame'
import type { Leverage, Ratio, Side } from '../types/game'

const RANK_POLL_MS = 30_000
const PRIME_CHECK_MS = 60_000

type ActiveModal = 'ranking' | 'quest' | 'academy' | 'quiz' | null
type PrivateModal = Exclude<ActiveModal, 'ranking' | null>

// 실시간 트레이딩 게임 — 상태별 분기: 서버 미설정/시즌 없음 → 준비 중, 연결 실패 → 재시도, 정상 → 트레이딩 화면
// 모달은 한 번에 하나(activeModal). 랭킹은 공개, 퀘스트·아카데미·퀴즈는 로그인 필요.
export default function GamePage() {
  const token = useAuthStore((s) => s.token)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const loggedIn = token !== null
  const {
    status, season, account, position, myRank, coach, academyUnlocked, streak, quizDisabled, lastPrice, sentiment,
    submitting, closing, loadSeason, loadPrivate, resetPrivate, refreshRank, placeOrder, closePosition, pushToast,
  } = useTradingGameStore()
  const [loginOpen, setLoginOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [primeTime, setPrimeTime] = useState(() => isQuizPrimeTime(new Date()))
  const ready = status === 'ready'

  useEffect(() => {
    loadSeason()
  }, [loadSeason])

  // 로그인 상태가 바뀌면 개인 데이터 로드/초기화
  useEffect(() => {
    if (!ready) return
    if (loggedIn) loadPrivate()
    else resetPrivate()
  }, [ready, loggedIn, loadPrivate, resetPrivate])

  // 로그아웃 시 로그인 전용 모달 닫기(랭킹은 공개라 유지)
  useEffect(() => {
    if (!loggedIn) setActiveModal((m) => (m === 'ranking' ? m : null))
  }, [loggedIn])

  // 보유 중 실시간 ROI 로 순위가 움직이므로 주기적으로 갱신
  useEffect(() => {
    if (!ready || !loggedIn) return
    const t = setInterval(() => refreshRank(), RANK_POLL_MS)
    return () => clearInterval(t)
  }, [ready, loggedIn, refreshRank])

  // 장 마감 후/주말 퀴즈 배너 — 1분마다 재판정(페이지를 켜 둔 채 15:30 을 넘기는 경우)
  useEffect(() => {
    const t = setInterval(() => setPrimeTime(isQuizPrimeTime(new Date())), PRIME_CHECK_MS)
    return () => clearInterval(t)
  }, [])

  useGameWebSocket(token, ready, () =>
    pushToast({ kind: 'error', icon: '🔑', message: '로그인이 만료되었어요. 다시 로그인해 주세요' }),
  )

  if (status === 'unavailable' || status === 'no-season') {
    return (
      <EmptyState
        emoji="🎮"
        title="시즌을 준비하고 있어요"
        description="곧 실시간 가상 트레이딩이 열려요. 조금만 기다려 주세요!"
      />
    )
  }
  if (status === 'error') {
    return (
      <EmptyState
        emoji="🔌"
        title="게임 서버에 연결할 수 없어요"
        description="잠시 후 다시 시도해 주세요."
        action={<Button onClick={() => loadSeason()}>다시 시도</Button>}
      />
    )
  }
  if (!ready || !season) return <p className="py-16 text-center text-ink-muted">불러오는 중…</p>

  const handleOrder = (side: Side, ratio: Ratio, leverage: Leverage) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    placeOrder(side, ratio, leverage)
  }

  const openPrivate = (m: PrivateModal) => {
    if (!loggedIn) {
      setLoginOpen(true)
      return
    }
    setActiveModal(m)
  }
  const closeModal = () => setActiveModal(null)

  return (
    <div className="space-y-4">
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
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted">로그인하면 실시간 시세와 주문이 열려요</p>
      )}
      <TradingChart ticker={season.ticker} lastPrice={lastPrice} coach={coach} position={position} />
      {position && (
        <ActivePositionCard position={position} lastPrice={lastPrice} closing={closing} onClose={() => closePosition()} />
      )}
      {primeTime && !quizDisabled && <QuizBanner onOpen={() => openPrivate('quiz')} />}
      <OrderPanel
        hasPosition={position !== null}
        academyUnlocked={academyUnlocked}
        submitting={submitting}
        onOrder={handleOrder}
        onLockedLeverage={() => openPrivate('academy')}
      />
      {/* 모달은 NudgeToaster 보다 먼저 렌더 — 같은 z-40 에서 토스트가 모달 위에 보이게 */}
      {activeModal === 'ranking' && <LeaderboardModal seasonId={season.id} myUserId={userId} onClose={closeModal} />}
      {activeModal === 'quest' && <QuestModal onClose={closeModal} />}
      {activeModal === 'academy' && <AcademyModal onClose={closeModal} />}
      {activeModal === 'quiz' && <ChartQuizModal onClose={closeModal} />}
      <NudgeToaster />
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 3: 검증** — 공통 web_client 검증 명령 + 번들 점검:

```bash
SP=/private/tmp/claude-501/-Users-kyuseok-Documents-private-projects-ivyro-work-space-stock-app/7aa4f14a-93aa-4418-a0e6-52bef2295e16/scratchpad
cd web_client
grep -l "localhost:800" dist/assets/*.js || echo "OK: localhost 없음"
ls dist/assets/GamePage-*.js
grep -l "퀴즈" dist/assets/index-*.js || echo "OK: 메인 청크에 게임 모달 없음"
NEW=$(wc -c < "$(ls dist/assets/index-*.js)" | tr -d ' '); BASE=$(cat "$SP/6b-main-chunk-baseline.txt")
echo "main chunk: $BASE -> $NEW (diff $((NEW - BASE)) bytes)"
```
기대: `OK: localhost 없음`, `GamePage-*.js` 1개 존재(지연 청크 유지), `OK: 메인 청크에 게임 모달 없음`, main chunk 차이 **1024 bytes 미만**(작성 시점 검증: +131 bytes — 지연 청크가 공유 React 바인딩(`useId`)을 추가로 참조하며 생기는 export 이름 차이뿐, 게임 코드 유입 아님). 1 KB 이상 늘면 메인 번들로 새어 나간 import 를 찾아 수정.

- [ ] **Step 4: 커밋**

```bash
git add web_client/src/components/game/GameHeader.tsx web_client/src/pages/GamePage.tsx
git commit -m "feat(web): 게임 화면에 모달 연결 — 랭킹·퀘스트·퀴즈 버튼, Streak 칩, 장 마감 후 퀴즈 배너, 5x 잠금 → 아카데미

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

---

### Task 8: 문서 + 브라우저 스모크 (컨트롤러 수행)

**Files:** Modify `README.md`(web_client 섹션), `docs/ROADMAP.md`(Phase 5 서브페이즈 6b 항목)

- [ ] **Step 1: README** — `### 4. 일반 유저 웹 (web_client)` 섹션의 `- **게임 탭(`/game`)** ...` 줄 바로 다음에 추가:

```markdown
- **게임 모달(6b)**: 헤더 `🏆 랭킹`(시즌 Top 100·명예의 전당 MBTI 칩, 비로그인 열람) · `🎯 퀘스트`(Q1~Q3 진행률·보상 수령·뱃지) · `🧩 퀴즈`(야간 10초 차트 퀴즈 — KST 15:30 이후·주말엔 주문 패널 위 배너, 관리자 플래그 QUIZ 가 꺼지면 숨김), 5x 🔒 칩 → 아카데미(3문항 통과 시 5배 레버리지 해금), 헤더 `🔥 n일 연속` Streak 칩. 백엔드 변경 없음(Phase 5b API). 퀘스트·퀴즈·아카데미는 로그인 필요.
```

- [ ] **Step 2: ROADMAP** — Phase 5의 `  - [ ] **6b** web 모달 — 랭킹/명예의전당(MBTI)·퀘스트·아카데미(5x 해금)·야간 퀴즈·Streak` 줄을 다음으로 교체:

```markdown
  - [x] **6b** web 모달 — 랭킹/명예의전당(MBTI)·퀘스트·아카데미(5x 해금)·야간 퀴즈·Streak (2026-10-13)
```

- [ ] **Step 3: 커밋**

```bash
git add README.md docs/ROADMAP.md
git commit -m "docs: README·ROADMAP — 트레이딩 게임 6b(web 모달) 반영

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XShzSztAa9mXvyvLBaXgQh"
```

- [ ] **Step 4: 브라우저 스모크(컨트롤러)** — 스펙 §6.3. 로컬 docker 전용 DB·Redis DB 9만 사용(dev 터널 15432 금지).

**4-1. DB·Redis 준비**

```bash
docker exec stock_postgres createdb -U stock_user stock_p6b_smoke
docker exec stock_redis redis-cli -n 9 FLUSHDB
cd backend
export DATABASE_URL=postgresql+asyncpg://stock_user:stock_password@localhost:5432/stock_p6b_smoke
export SYNC_DATABASE_URL=postgresql+psycopg2://stock_user:stock_password@localhost:5432/stock_p6b_smoke
export REDIS_URL=redis://localhost:6379/9
uv run alembic upgrade head
uv run python -m scripts.seed_trading_game        # 시즌 1기(005930, ACTIVE) + 모닝 코치
```
(`shared/env.py`는 `load_dotenv(override=False)` — 위 export 가 `.env.development`보다 우선.)

**4-2. 서비스 기동**(각각 별도 터미널, 위 export 3개를 같은 셸에 설정한 상태로)

```bash
cd backend
uv run uvicorn apps.auth.main:app --port 8001
uv run uvicorn apps.blog.main:app --port 8000
uv run uvicorn apps.stock_api.main:app --port 8002
TRADING_WINDOWS=00:00-23:59 STALE_SECONDS=86400 uv run uvicorn apps.trading_game.main:app --port 8003 --workers 1
cd web_client && npm run dev                      # http://localhost:3000/game
```
(`STALE_SECONDS=86400`: 아래 시세 키를 한 번만 넣어도 주문 신선도 게이트 통과. `ts`는 epoch **초**.)

```bash
docker exec stock_redis redis-cli -n 9 SET stock:latest:005930 "{\"price\":71200,\"ts\":$(date +%s)}"
```

**4-3. 데이터 시드**

차트 퀴즈 3문제(60캔들, `base_date` 서로 다름 — 정답 제출·시간 초과·1문제 여유, 4번째 시작에서 소진 문구 확인):

```bash
python3 - <<'EOF' | docker exec -i stock_postgres psql -U stock_user -d stock_p6b_smoke
import json, random
random.seed(6)
QUIZZES = [("2026-03-13", "UP", "3.20", "골든크로스"), ("2026-04-10", "DOWN", "-2.50", "데드크로스"), ("2026-05-15", "UP", "1.80", "정배열")]
values = []
for base, ans, chg, pat in QUIZZES:
    p, snap = 70000, []
    for d in range(60):
        c = round(p * (1 + random.uniform(-0.02, 0.02)))
        snap.append({"date": f"2026-01-{d % 28 + 1:02d}", "open": p, "high": max(p, c) + random.randint(0, 500),
                     "low": min(p, c) - random.randint(0, 500), "close": c, "volume": random.randint(10**6, 3 * 10**6)})
        p = c
    values.append(f"('005930', '{base}', '{pat}', '{json.dumps(snap)}', '{ans}', {chg}, '### {pat}\n- 스모크용 해설입니다.')")
print("INSERT INTO chart_quiz_pool (ticker, base_date, pattern_type, chart_snapshot, answer, actual_change, explanation) VALUES\n" + ",\n".join(values) + ";")
EOF
```
기대: `INSERT 0 3`.

명예의 전당 2행(MBTI 있음/없음):

```bash
docker exec -i stock_postgres psql -U stock_user -d stock_p6b_smoke <<'EOF'
INSERT INTO hall_of_fame (season_id, rank, user_nickname, final_roi, final_asset, win_rate, trading_mbti)
SELECT id, 1, '전설의개미', 42.5000, 14250000.00, 66.67, '냉철한 원칙주의자' FROM game_seasons WHERE season_number = 1
UNION ALL
SELECT id, 2, '존버장인', -3.2000, 9680000.00, 40.00, NULL::varchar FROM game_seasons WHERE season_number = 1;
EOF
```
기대: `INSERT 0 2`.

**4-4. Q1(손절 지정 주문) — UI에 손절 입력이 없으므로 API 직접 호출.** 게스트 이메일은 닉네임에서 파생되므로 **브라우저 로그인 닉네임과 반드시 같은 값**(`스모크6b`)을 쓴다.

```bash
TOKEN=$(curl -s -X POST http://localhost:8001/api/v1/auth/guest -H 'Content-Type: application/json' \
  -d '{"nickname":"스모크6b"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
SEASON_ID=$(docker exec stock_postgres psql -U stock_user -d stock_p6b_smoke -tAc "SELECT id FROM game_seasons WHERE season_number = 1")
docker exec stock_redis redis-cli -n 9 SET stock:latest:005930 "{\"price\":71200,\"ts\":$(date +%s)}"
curl -s -X POST http://localhost:8003/api/game/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"season_id\":$SEASON_ID,\"side\":\"LONG\",\"ratio\":0.25,\"leverage\":1,\"stop_loss_pct\":0.05}"
```
기대: 200, 응답 `stop_loss_price` ≈ `67640`(71200×0.95, null 아님) — Q1 완료, Q3 1/3, Streak 1일.

**4-5. 브라우저 확인**(`http://localhost:3000/game`)

1. **랭킹(비로그인)**: `🏆 랭킹` → 모달 열림(로그인 요구 없음). 시즌 랭킹(순위가 아직 없으면 "아직 순위가 없어요") → `명예의 전당` 탭: `시즌 1` 헤더, `전설의개미` 행에 `냉철한 원칙주의자` 칩, `존버장인` 행엔 칩 없음, 승률 `66.7%`/`40.0%`(+ 부호 없음).
2. **로그인**: `🎯 퀘스트` 클릭 → LoginModal(모달 대신 열림) → 닉네임 `스모크6b`로 로그인(로그인 후 퀘스트 모달은 자동으로 열리지 않음 — 버튼을 다시 클릭). 헤더에 `🔥 1일 연속`(title `최고 기록 1일`), 포지션 카드(4-4 주문) 표시.
3. **퀘스트**: Q1 `보상 받기` → 토스트 "보상을 받았어요"(모달 위에 보임) → `받음 ✓`, 헤더 자본금 +₩500,000. 다시 열어도 `받음 ✓`. Q3 막대 1/3·`진행 중`.
4. **랭킹 내 행**: 포지션 카드에서 청산 → `🏆 랭킹` → 내 행(`스모크6b`) `bg-brand-soft` 강조 + `나` 표시.
5. **아카데미**: 배율 `5x 🔒` → 아카데미 모달. 오답(1번 첫 선택지 등) 제출 → ❌·정답·해설·`다시 도전` → 정답(1번 3번째 · 2번 2번째 · 3번 3번째 선택지) 제출 → 전부 ✅, 토스트 "5배 레버리지가 해금됐어요", 모달 닫으면 칩이 `5x`(🔒 없음) → 5x 선택 후 BUY → 주문 성공(포지션 카드 레버리지 5x). 확인 후 청산.
6. **퀴즈**: `🧩 퀴즈` → intro → `시작` → 차트(시간축·날짜 없음) + `⏱ 10초` 카운트다운(3초 이하 빨강) → `오를까? 📈` → 결과: 정답/오답, `실제 5일 등락 +3.2%` 등, 패턴, 해설, `종목 005930 · 기준일 2026-03-13` 등, 정답이면 `+₩200,000 지급` + 헤더 자본금 증가, Streak 칩 유지. `다음 문제` → 아무것도 고르지 않고 10초 대기 → `⏰ 시간 초과`(정답 미공개) → `다음 문제` → 1문제 풀이 → `다음 문제` → "준비된 문제를 모두 풀었어요"(다시 시도 버튼 없음).
7. **퀴즈 플래그 OFF**:
   ```bash
   docker exec stock_postgres psql -U stock_user -d stock_p6b_smoke -c "INSERT INTO game_feature_flags (key, enabled, updated_at) VALUES ('QUIZ', false, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();"
   docker exec stock_redis redis-cli -n 9 DEL game:flag:QUIZ     # 30초 캐시(game:flag:QUIZ) 즉시 무효화
   ```
   (문제가 소진된 상태여도 플래그 판정이 출제보다 먼저라 503 이 난다.) `🧩 퀴즈` → `시작` → 모달 닫힘 + 토스트 "지금은 운영하지 않는 기능이에요" → 헤더 `🧩 퀴즈` 버튼·배너 사라짐(새로고침 전까지). 끝나면 같은 명령에서 `false` → `true`로 바꿔 실행하고 같은 `DEL`.
8. **배너**: 브라우저 시각이 KST 15:30 이후·주말이면 주문 패널 위 "🧩 야간 10초 차트 퀴즈 도전!"(클릭 → 퀴즈 모달). 평일 장중이면 배너 없음 — 경계는 Task 1 Step 6 assert 로 대체.
9. **공통**: 각 모달 ESC·바깥 클릭·✕로 닫힘, 모바일 폭(390px)에서 하단 시트·가로 스크롤 없음, 비로그인 상태에서 `🎯 퀘스트`/`🧩 퀴즈`/`5x 🔒` → LoginModal, 로그인 전용 모달을 연 채 로그아웃 → 모달 닫힘, 콘솔 에러 없음.

**4-6. 정리**: 서버 종료 → `docker exec stock_postgres dropdb -U stock_user stock_p6b_smoke` → `docker exec stock_redis redis-cli -n 9 FLUSHDB`.

---

## 스펙 대응표 (셀프 리뷰)

| 스펙 | 태스크 |
|---|---|
| §2 헤더 버튼 활성화·🧩 퀴즈·Streak 칩 조건 | 7 (`GameHeader`) |
| §2 퀴즈 배너(KST 15:30~24:00·토/일, `isQuizPrimeTime`) | 1 (`lib/quiz`), 6 (`QuizBanner`), 7 |
| §2 503 → `quizDisabled` → 배너·버튼 숨김 | 2, 6, 7 |
| §2 5x 🔒 → 아카데미 / 랭킹 공개·나머지 LoginModal | 7 |
| §3 계약 9종 | 1 (`api/game`) |
| §4 `Modal`(ESC·바깥 클릭·role=dialog·aria-modal·하단 시트) | 3 |
| §4 모달 로컬 state / 전역은 streak·academyUnlocked·quizDisabled / 한 번에 하나 | 2–7 (조건부 마운트 + `activeModal`) |
| §4.1 랭킹 탭·내 행 강조·익명·MBTI 칩·빈 목록 문구 | 3 |
| §4.2 퀘스트 카드·진행 막대·보상 표기·상태 버튼·수령 후 갱신/토스트·뱃지 | 4 |
| §4.3 아카데미 해금 안내·라디오·제출·결과·다시 도전 | 5 |
| §4.4 퀴즈 단계·미니 차트·200ms 카운트다운·0초 로컬 시간 초과·결과 표기·오류 분기·타이머 정리 | 1, 6 |
| §4.5 Streak — loadPrivate·주문 후 refresh·퀴즈 응답 반영 | 2, 6 |
| §5 오류 문구 매핑·`orderErrorMessage` 6a 유지 | 1 (assert 포함) |
| §6 검증(tsc·build·지연 청크·localhost·순수 함수·스모크) | 1, 7, 8 |
| §7 README·ROADMAP | 8 |

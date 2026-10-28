// trading_game(8003) 계약 타입.
// 출처: backend/apps/trading_game/schemas/game_dtos.py, routers/{orders,leaderboard,coach,academy}.py,
//       services/{tick_listener,coach_service,connection_manager}.py, routers/ws_gateway.py
// pydantic v2 는 Decimal 을 JSON 문자열로 직렬화한다 → Raw* 는 문자열(Dec), 도메인 타입은 number.

export type Side = 'LONG' | 'SHORT'
/** 주문 비중 — 칩 25/50/100% + 드롭다운 10~90% (backend OrderRequest.ratio) */
export type Ratio = 0.1 | 0.2 | 0.25 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.75 | 0.8 | 0.9 | 1.0
export type Leverage = 1 | 2 | 5

/** Decimal 직렬화 값. 서버는 문자열을 보내지만 방어적으로 number 도 허용 */
export type Dec = string | number

/** GET /api/game/seasons/active (SeasonOption) */
export interface Season {
  id: number
  season_number: number
  ticker: string
  stock_name: string
  status: string
  start_at: string
  end_at: string | null
  /** 시즌 기간 — 'quarter' 일 때만 월간 랭킹을 연다(구 서버 응답엔 없을 수 있음) */
  period?: SeasonPeriod
  /** 관리자 기능 on/off(게임 설정) — 꺼진 기능은 버튼·배너를 숨긴다(구 서버 응답엔 없음 → 켜짐) */
  features?: { quiz: boolean; streak: boolean }
}

export type SeasonPeriod = 'month' | 'quarter'

export interface RawAccount {
  season_id: number
  cash_balance: Dec
  total_asset: Dec
  current_roi: Dec
  total_trades: number
  win_trades: number
}

export interface Account {
  season_id: number
  cash_balance: number
  total_asset: number
  current_roi: number
  total_trades: number
  win_trades: number
}

export interface RawPosition {
  id: string
  side: Side
  entry_price: Dec
  size_amount: Dec
  leverage: number
  stop_loss_price: Dec | null
  take_profit_price: Dec | null
  status: string
  roi_pct: Dec | null
  pnl_amount: Dec | null
}

export interface Position {
  id: string
  side: Side
  entry_price: number
  size_amount: number
  leverage: number
  stop_loss_price: number | null
  take_profit_price: number | null
  status: string
  roi_pct: number | null
  pnl_amount: number | null
}

/** NudgeDTO — type: WARNING | PRAISE | ADVICE */
export interface Nudge {
  type: string
  code: string
  message: string
}

export interface RawOrderResult extends RawPosition {
  nudges: Nudge[]
  /** 이번 청산 실현 손익(주문·옛 서버면 없음/null) */
  realized_pnl?: Dec | null
  /** 이번 청산으로 현금에 돌아온 금액(주문·옛 서버면 없음/null) */
  returned_amount?: Dec | null
}

/** 부분 청산이면 position.status === 'OPEN'(size_amount = 남은 원금) */
export interface OrderResult {
  position: Position
  nudges: Nudge[]
  realized_pnl: number | null
  returned_amount: number | null
}

export interface OrderRequest {
  season_id: number
  side: Side
  ratio: Ratio
  leverage: Leverage
  /** 진입가 대비 주가 변동 분수(0.05=5%). null/생략이면 미설정 */
  stop_loss_pct?: number | null
  take_profit_pct?: number | null
}

/** placeOrder 선택 인자 — 손절/익절(주가 기준 분수) */
export interface OrderOptions {
  stopLossPct?: number | null
  takeProfitPct?: number | null
}

/** GET /api/game/seasons/{id}/my-rank (ranking_service.my_rank — 이미 float) */
export interface MyRank {
  rank: number | null
  roi_pct: number | null
  percentile: number | null
  total: number
}

export interface RawCoachMessage {
  id: number
  season_id: number
  target_date: string
  coach_type: string
  title: string
  summary_nudge: string
  content_md: string
  support_price: Dec | null
  resistance_price: Dec | null
  status: string
  published_at: string | null
}

export interface RawCoachToday {
  target_date: string
  season_id: number | null
  morning: RawCoachMessage | null
  evening: RawCoachMessage | null
  active: RawCoachMessage | null
}

/** 화면용 코치 — REST active 또는 WS coach 메시지(content_md 없음 → null)에서 생성 */
export interface Coach {
  season_id: number
  coach_type: string
  title: string
  summary_nudge: string
  content_md: string | null
  support_price: number | null
  resistance_price: number | null
}

export interface Sentiment {
  long_pct: number
  short_pct: number
  /** 보유 중 포지션 수(=보유 인원). 구 서버 응답엔 없을 수 있음 */
  total?: number
}

/** stock_api getChartData.candles (date = 'YYYY-MM-DD') */
export interface DailyCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  /** 거래량 — 매물대용. 당일 세션 봉·틱 병합 봉에는 없을 수 있다 */
  volume?: number
}

/** 차트 단위(spec 2026-10-14 chart-intervals). 'day' = 일봉 */
export type ChartInterval = 'day' | '1m' | '5m' | '15m' | '60m'
export type IntradayInterval = Exclude<ChartInterval, 'day'>
export const CHART_INTERVALS: ChartInterval[] = ['day', '1m', '5m', '15m', '60m']

/** GET /api/game/candles 의 분봉 1개. t = 버킷 시작(UTC epoch seconds) */
export interface IntradayCandle {
  t: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface IntradayCandles {
  interval: IntradayInterval
  ticker: string
  candles: IntradayCandle[]
}

/** WS /ws/game/stream 서버→클라 메시지(파싱·정규화 후) */
/** 장운영 상태(GET /api/game/market-status · WS market_status) — VI·거래정지·서킷브레이크·사이드카 */
export type MarketStatusState = 'NORMAL' | 'HALTED' | 'CIRCUIT_BREAKER' | 'MARKET_PAUSED' | 'VI' | 'SIDECAR'
export interface MarketStatus {
  ticker: string | null
  state: MarketStatusState
  /** 서버가 만든 사용자 문구(배너에 그대로) */
  message: string
  /** true 면 지금 주문·청산이 막힘(사이드카는 false — 안내만) */
  blocking: boolean
  since: string | null
}

export type GameWsMessage =
  | { type: 'tick'; ticker: string; price: number }
  | ({ type: 'market_status' } & MarketStatus)
  | { type: 'position_pnl'; position_id: string; roi_pct: number; pnl_amount: number }
  | ({ type: 'sentiment' } & Sentiment)
  | { type: 'nudge'; position_id: string; nudge: Nudge }
  | { type: 'coach'; coach: Coach }

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
  season_number: number
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
  /** 예측 기간(거래일) — 구 서버는 없음(=5) */
  horizon_bars?: number
  /** 문제 유형 — 구 서버는 없음(=DIRECTION) */
  quiz_type?: string
  /** 4지선다 보기 — DIRECTION 은 null */
  choices?: { code: unknown; label: unknown }[] | null
}

export interface QuizQuestion {
  id: number
  chart_snapshot: QuizCandle[]
  time_limit_sec: number
  /** "N거래일 뒤" 의 N */
  horizon_bars: number
  /** DIRECTION(오를까/내릴까) | RANGE(등락폭 구간) | PATTERN(신호 맞히기) */
  quiz_type: QuizType
  /** 4지선다 보기(출제 순서) — DIRECTION 은 빈 배열 */
  choices: QuizOption[]
}

export type QuizType = 'DIRECTION' | 'RANGE' | 'PATTERN'

export interface QuizOption {
  code: string
  label: string
}

/** DIRECTION 은 'UP' | 'DOWN', 4지선다는 보기의 code */
export type QuizChoice = string

/** 연속 출석 마일스톤 보상(StreakRewardDTO — amount 는 정수 원) */
export interface StreakReward {
  milestone: number
  amount: number
  claimed: boolean
  claimable: boolean
}

/** GET /api/game/streak/my (StreakResponse) */
export interface Streak {
  current_streak: number
  highest_streak: number
  last_activity_date: string | null
  enabled: boolean
  /** 플래그 꺼짐·활성 시즌 없음이면 빈 배열 */
  rewards: StreakReward[]
}

/** POST /api/game/streak/rewards/{milestone}/claim (StreakRewardClaimResponse) */
export interface RawStreakClaimResult {
  streak: Streak
  cash_balance: Dec
}

export interface StreakClaimResult {
  streak: Streak
  cash_balance: number
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
  /** 기준일 다음 horizon_bars 봉(문제와 같은 정규화). 구 서버·이전 생성분은 없음/null */
  future_snapshot?: Record<string, unknown>[] | null
  outcome?: string | null
}

export interface QuizResult {
  correct: boolean
  answer: QuizChoice
  /** 기준일 대비 horizon_bars 거래일 후 등락률(%) */
  actual_change: number
  pattern_type: string
  explanation: string
  rewarded: boolean
  reward_cash: number
  timed_out: boolean
  ticker: string
  base_date: string
  streak: Streak | null
  /** 정답 공개용 이후 봉 — 없으면 빈 배열 */
  future_snapshot: QuizCandle[]
  /** 패턴 기대 방향 vs 실제 결과 한 줄 — 없으면 null */
  outcome: string | null
}

export interface WeeklyEntry {
  rank: number
  user_id: number
  nickname: string | null
  weekly_roi: number
}

export interface WeeklyBoard {
  week_start: string
  start_at: string
  end_at: string
  entries: WeeklyEntry[]
}

export interface WeeklyMyRank {
  rank: number | null
  weekly_roi: number | null
  total: number
}

export interface WeeklyResultWeek {
  season_id: number
  week_start: string
  entries: { rank: number; nickname: string | null; weekly_roi: number; reward_amount: number }[]
}

export interface WeeklyReward {
  id: number
  /** 월간은 그 달 1일 */
  week_start: string
  rank: number
  reward_amount: number
  /** 구 서버 응답엔 없을 수 있음 → 'week' 로 간주 */
  period_type?: 'week' | 'month'
}

export interface MonthlyEntry {
  rank: number
  user_id: number
  nickname: string | null
  monthly_roi: number
}

/** 월간 시즌이면 month_start·start_at·end_at 이 null, entries 빈 배열 */
export interface MonthlyBoard {
  month_start: string | null
  start_at: string | null
  end_at: string | null
  entries: MonthlyEntry[]
}

export interface MonthlyMyRank {
  rank: number | null
  monthly_roi: number | null
  total: number
}

export interface MonthlyResultMonth {
  season_id: number
  month_start: string
  entries: { rank: number; nickname: string | null; monthly_roi: number; reward_amount: number }[]
}

/** GET /api/game/reward-config — 안내 문구용 보상 금액 */
export interface RewardConfig {
  weekly: number[]
  monthly: number[]
  streak: Record<string, number>
}

/** GET /api/game/rules (공개) — 실제 계산 상수. 규칙 화면 문구의 숫자는 모두 여기서 */
export interface GameRules {
  initial_cash: number
  min_order_amount: number
  max_open_positions: number
  /** KST [["09:00","15:30"], ...] */
  trading_windows: [string, string][]
  leverages: number[]
  /** {"5": "academy"} — 해금 조건 */
  leverage_unlock: Record<string, string>
  /** 왕복 수수료 % (0.03 = 0.03%) */
  fee_roundtrip_pct: number
  /** 자동 청산 수익률 % (-80) */
  margin_call_roi_pct: number
  sentiment_interval_sec: number
  rewards: RewardConfig
  /** 관리자 설정 차트 기본 단위(구버전 서버엔 없음 → 정규화에서 'day') */
  chart_interval_default: ChartInterval
  chart_intervals: ChartInterval[]
  /** 부분 익절·원금 회수 지원(구 서버면 없음 → 버튼 숨김. 옛 서버는 portion 을 무시하고 전량 청산) */
  partial_close?: boolean
}

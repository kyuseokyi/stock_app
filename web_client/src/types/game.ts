// trading_game(8003) 계약 타입.
// 출처: backend/apps/trading_game/schemas/game_dtos.py, routers/{orders,leaderboard,coach,academy}.py,
//       services/{tick_listener,coach_service,connection_manager}.py, routers/ws_gateway.py
// pydantic v2 는 Decimal 을 JSON 문자열로 직렬화한다 → Raw* 는 문자열(Dec), 도메인 타입은 number.

export type Side = 'LONG' | 'SHORT'
export type Ratio = 0.25 | 0.5 | 1.0
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
}

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
}

export interface OrderResult {
  position: Position
  nudges: Nudge[]
}

export interface OrderRequest {
  season_id: number
  side: Side
  ratio: Ratio
  leverage: Leverage
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
}

/** stock_api getChartData.candles (date = 'YYYY-MM-DD') */
export interface DailyCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
}

/** WS /ws/game/stream 서버→클라 메시지(파싱·정규화 후) */
export type GameWsMessage =
  | { type: 'tick'; ticker: string; price: number }
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

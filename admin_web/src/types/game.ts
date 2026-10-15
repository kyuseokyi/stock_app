// trading_game 코치·시즌 DTO. 출처: backend/apps/trading_game/schemas/game_dtos.py (Phase 5a)
// pydantic Decimal → JSON 문자열, date/datetime → ISO 문자열.

export type CoachType = 'MORNING' | 'EVENING'
export type CoachStatus = 'DRAFT' | 'PUBLISHED'
export type CoachAction = 'draft' | 'publish'

export interface CoachMessage {
  id: number
  season_id: number
  target_date: string // YYYY-MM-DD
  coach_type: CoachType
  title: string
  summary_nudge: string
  content_md: string
  support_price: string | null
  resistance_price: string | null
  status: CoachStatus
  published_at: string | null
}

export interface CoachUpsertBody {
  season_id: number
  target_date: string
  coach_type: CoachType
  title: string
  summary_nudge: string
  content_md: string
  support_price: number | null
  resistance_price: number | null
  action: CoachAction
}

// 지지·저항 추천값(GET /api/game/admin/coach-levels/suggest) — 폼 채우기용
export interface CoachLevelSuggestion {
  price: number
  touches: number
  basis: string
}

export interface CoachLevels {
  ticker: string
  basis_end: string // 이 날짜까지의 일봉으로 계산
  bars: number
  last_close: number
  support: CoachLevelSuggestion | null
  resistance: CoachLevelSuggestion | null
}

export interface SeasonOption {
  id: number
  season_number: number
  ticker: string
  stock_name: string
  status: string // READY | ACTIVE | FINISHED
  start_at: string
  end_at: string | null
  period?: SeasonPeriod // 구버전 서버 응답엔 없을 수 있음(기본 month)
}

// 게임 운영 설정(시즌 기간·보상 금액). 출처: game_settings_service / GET·PUT /api/game/admin/settings
export type SeasonPeriod = 'month' | 'quarter'
export type StreakRewardKey = '3' | '7' | '14' | '30'

export interface GameSettings {
  next_season_period: SeasonPeriod
  weekly_rewards: [number, number, number]
  monthly_rewards: [number, number, number]
  streak_rewards: Record<StreakRewardKey, number>
  /** 게임 차트 기본 단위(spec 2026-10-14 chart-intervals §5). 구버전 서버 응답엔 없을 수 있음 → 'day' */
  chart_interval_default?: ChartInterval
}

export type ChartInterval = 'day' | '1m' | '5m' | '15m' | '60m'

// 기능 on/off (Phase 5b). 출처: game_dtos.FeatureFlagResponse
export type FeatureFlagKey = 'QUIZ' | 'STREAK'

export interface FeatureFlag {
  key: FeatureFlagKey
  enabled: boolean
  updated_at: string | null
}

// 아카데미 문항·퀴즈 관리(백로그 ⑤-2). 출처: game_dtos.AcademyQuestionAdminDTO / Quiz* (Decimal → 문자열)
export interface AcademyQuestionAdmin {
  id: number
  question: string
  choices: string[]
  answer: number // 0-based
  explanation: string
  sort_order: number
  is_active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface AcademyQuestionBody {
  question: string
  choices: string[] // 2~6개, 각 1~200자
  answer: number
  explanation: string
  sort_order: number
  is_active: boolean
}

export type QuizAnswer = 'UP' | 'DOWN'

export interface QuizSnapshotCandle {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface QuizAdminItem {
  id: number
  ticker: string
  base_date: string
  pattern_type: string
  answer: QuizAnswer
  actual_change: string // Decimal(%)
  is_active: boolean
  attempt_count: number
  created_at: string | null
}

export interface QuizAdminList {
  items: QuizAdminItem[]
  total: number
  page: number
  size: number
}

export interface QuizAdminDetail extends QuizAdminItem {
  explanation: string
  reward_cash: number
  chart_snapshot: QuizSnapshotCandle[] // 기준일까지 60봉
}

export interface QuizAdminUpdateBody {
  pattern_type?: string
  explanation?: string
  is_active?: boolean
}

export interface QuizGenerateResult {
  created: number
  skipped: number
}

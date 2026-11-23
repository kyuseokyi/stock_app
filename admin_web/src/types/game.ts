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
// REAL_MARKET = 실시간(실제 시세) 게임 스위치(A안 — 기본 꺼짐, 켜려면 KRX/코스콤 라이선스 필요).
//   게임 모드도 이 값 하나로 정한다: ON → 사용자에게 실시간 게임만, OFF → 가상 데이터(교육용 종가) 게임만
// EDU_DAILY_GAME = 가상 데이터(교육용 합성 종가) 게임(기본 켜짐) — REAL_MARKET OFF 일 때 표시. 서버가 모르는 키를 더 보내도 화면은 FLAG_META 에 있는 것만 그린다
export type FeatureFlagKey = 'QUIZ' | 'STREAK' | 'REAL_MARKET' | 'EDU_DAILY_GAME'

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

/** DIRECTION 은 'UP' | 'DOWN', 4지선다는 보기 code(R_UP, GOLDEN_CROSS …) */
export type QuizAnswer = string

export type QuizType = 'DIRECTION' | 'RANGE' | 'PATTERN'

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
  /** 문제 차트 길이·예측 기간(거래일) — 구 서버는 없음(=60·5) */
  window_bars?: number
  horizon_bars?: number
  /** 문제 유형·정답 보기 문구 — 구 서버는 없음(=DIRECTION, UP/DOWN) */
  quiz_type?: QuizType
  answer_label?: string
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
  chart_snapshot: QuizSnapshotCandle[] // 기준일까지 window_bars 봉
  future_snapshot?: QuizSnapshotCandle[] | null // 이후 horizon_bars 봉 — B2 이전 생성분은 null
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

// 교육용 합성 종가 게임 관리자(/api/game/admin/edu/*). 출처: edu_game_dtos.EduAdminSeasonDTO 등
export type EduRegime = 'ACCUMULATION' | 'UPTREND' | 'DISTRIBUTION' | 'DOWNTREND'

export interface EduAdminSeason {
  id: number
  season_number: number
  synthetic_code: string
  title: string
  theme_category: string
  hide_name: boolean
  current_day_index: number
  current_regime: EduRegime | string
  regime_days_left: number
  next_regime_override: EduRegime | string | null
  status: string
  start_date: string
  last_advanced_date: string | null
  participants: number
}

export interface EduNewSeasonBody {
  title: string
  theme_category: string
  hide_name: boolean
  start_price: 50000 | 100000
}

export interface EduAdvanceResult {
  status: 'advanced' | 'skipped' | 'no_season' | string
  season_id: number | null
  day_index: number | null
  close: number | null
  regime: string | null
  settled: number
  closed: number
}

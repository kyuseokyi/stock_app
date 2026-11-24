// 교육용 합성 종가 게임(/api/game/edu/*) 타입. 출처: backend apps/trading_game/schemas/edu_game_dtos.py
// 가격은 호가 단위 정수(원), 금액은 float, 수익률·등락률은 %(float). 날짜는 'YYYY-MM-DD', 시각은 +09:00 ISO.

export type EduActionType = 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD_WATCH' | 'KEEP_POS' | 'PARTIAL_CLOSE' | 'FULL_CLOSE'
export type EduSide = 'LONG' | 'SHORT'
export type EduRatio = 0.25 | 0.5 | 1
export type EduLeverage = 1 | 2 | 5
export type EduStopLossPct = 3 | 5 | 7
export type EduTakeProfitPct = 5 | 10 | 15

export interface EduSeason {
  id: number
  season_number: number
  synthetic_code: string
  /** hide_name 이면 '블라인드 교육 차트 #N', 아니면 title */
  display_name: string
  title: string | null
  theme_category: string | null
  hide_name: boolean
  current_day_index: number
  status: string
  start_date: string
  initial_cash: number
}

export interface EduCandle {
  day_index: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  change_pct: number
  pattern_tag: string | null
}

export interface EduToday {
  day_index: number
  date: string
  close: number
  change_pct: number
  pattern_tag: string | null
  coach_comment: string | null
  support_price: number | null
  resistance_price: number | null
  poc_price: number | null
}

export interface EduCrowd {
  total: number
  long: number
  short: number
  watch: number
  long_pct: number
  short_pct: number
  watch_pct: number
}

export interface EduPosition {
  side: EduSide
  entry_price: number
  size_amount: number
  leverage: number
  stop_loss_price: number | null
  take_profit_price: number | null
  opened_day_index: number | null
  unrealized_pnl: number
  roi_pct: number
}

export interface EduAccount {
  cash_balance: number
  bonus_cash: number
  total_asset: number
  current_roi: number
  max_roi: number
  total_trades: number
  win_trades: number
  participation_days: number
  last_action_day_index: number | null
  position: EduPosition | null
}

export interface EduAction {
  day_index: number
  action_date: string
  action_type: EduActionType | string
  side: string | null
  ratio: number | null
  leverage: number
  stop_loss_price: number | null
  take_profit_price: number | null
  execution_price: number
  realized_pnl: number | null
  settlement_note: string | null
}

export interface EduOptions {
  ratios: number[]
  leverages: number[]
  stop_loss_pcts: number[]
  take_profit_pcts: number[]
  leverage_5x_unlocked: boolean
  hold_watch_bonus: number
}

/** GET /api/game/edu/features — 게임 탭 노출 판단용 전역 플래그 두 개(사용자 무관, 시즌을 만들지 않음) */
export interface EduFeatures {
  /** EDU_DAILY_GAME — 교육용(가상 데이터) 게임 공개 여부 */
  enabled: boolean
  /** 관리자 전역 REAL_MARKET 스위치 */
  real_market_switch: boolean
}

/** enabled=false 면 나머지는 기본값(null/빈 배열) — 화면은 게임을 숨긴다 */
export interface EduState {
  enabled: boolean
  /** 관리자 전역 REAL_MARKET 스위치(사용자별 판정 아님) — true=실시간 게임만, false=가상 데이터 게임만. 옛 서버는 없음(=false) */
  real_market_switch?: boolean
  season: EduSeason | null
  candles: EduCandle[]
  today: EduToday | null
  crowd: EduCrowd | null
  next_settlement_at: string | null
  logged_in: boolean
  today_submitted: boolean
  today_action: EduAction | null
  account: EduAccount | null
  options: EduOptions | null
  disclaimer: string | null
}

export interface EduActionRequest {
  action: EduActionType
  /** 화면에 표시 중인 봉 번호(state.season.current_day_index) — 서버 현재 봉과 다르면 409 STALE_DAY */
  day_index?: number
  ratio?: EduRatio
  leverage?: EduLeverage
  stop_loss_pct?: EduStopLossPct
  take_profit_pct?: EduTakeProfitPct
}

export interface EduActionResponse {
  action: EduAction
  account: EduAccount
  bonus_cash_awarded: number
  streak: number | null
  message: string
}

export interface EduLeaderRow {
  rank: number
  nickname: string | null
  current_roi: number
  total_asset: number
  participation_days: number
  win_trades: number
  total_trades: number
}

export interface EduLeaderboard {
  season_id: number
  top: EduLeaderRow[]
  my_rank: EduLeaderRow | null
}

export interface EduHistory {
  season_id: number
  actions: EduAction[]
}

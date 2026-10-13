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

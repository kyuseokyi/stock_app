// 교육용 합성 종가 게임(/api/game/edu/*) 응답 타입 — backend/apps/trading_game/schemas/edu_game_dtos.py 와 같은 계약.
// 가격은 호가 단위 정수(원), 금액은 소수 2자리, 수익률·등락률은 %. 날짜는 'YYYY-MM-DD', 시각은 +09:00 ISO 문자열.

export type EduSide = 'LONG' | 'SHORT';
export type EduActionType = 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD_WATCH' | 'KEEP_POS' | 'PARTIAL_CLOSE' | 'FULL_CLOSE';

export interface EduSeason {
  id: number;
  season_number: number;
  synthetic_code: string;
  /** hide_name 이면 '블라인드 교육 차트 #N', 아니면 title */
  display_name: string;
  title: string | null;
  theme_category: string | null;
  hide_name: boolean;
  current_day_index: number;
  status: string;
  start_date: string;
  initial_cash: number;
}

export interface EduCandle {
  day_index: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change_pct: number;
  pattern_tag: string | null;
}

/** 오늘(마지막 공개 봉)의 해설·기준선 */
export interface EduToday {
  day_index: number;
  date: string;
  close: number;
  change_pct: number;
  pattern_tag: string | null;
  coach_comment: string | null;
  support_price: number | null;
  resistance_price: number | null;
  poc_price: number | null;
}

export interface EduCrowd {
  total: number;
  long: number;
  short: number;
  watch: number;
  long_pct: number;
  short_pct: number;
  watch_pct: number;
}

export interface EduPosition {
  side: EduSide;
  entry_price: number;
  size_amount: number;
  leverage: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  opened_day_index: number | null;
  unrealized_pnl: number;
  /** 진입 금액 대비 평가 손익률(%) */
  roi_pct: number;
}

export interface EduAccount {
  cash_balance: number;
  bonus_cash: number;
  total_asset: number;
  current_roi: number;
  max_roi: number;
  total_trades: number;
  win_trades: number;
  participation_days: number;
  last_action_day_index: number | null;
  position: EduPosition | null;
}

export interface EduAction {
  day_index: number;
  action_date: string;
  action_type: EduActionType | string;
  side: EduSide | null;
  ratio: number | null;
  leverage: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  execution_price: number;
  realized_pnl: number | null;
  settlement_note: string | null;
}

export interface EduOptions {
  ratios: number[];
  leverages: number[];
  stop_loss_pcts: number[];
  take_profit_pcts: number[];
  leverage_5x_unlocked: boolean;
  hold_watch_bonus: number;
}

/** enabled=false 면 나머지는 기본값(null/빈 배열) — 화면은 게임을 숨긴다 */
export interface EduState {
  enabled: boolean;
  season: EduSeason | null;
  candles: EduCandle[];
  today: EduToday | null;
  crowd: EduCrowd | null;
  next_settlement_at: string | null;
  logged_in: boolean;
  today_submitted: boolean;
  today_action: EduAction | null;
  account: EduAccount | null;
  options: EduOptions | null;
  disclaimer: string | null;
}

export interface EduActionRequest {
  action: EduActionType;
  /** 진입(ENTER_*) 필수 */
  ratio?: number | null;
  leverage?: number;
  /** 진입 필수, KEEP_POS 는 다시 정할 때만(진입가 기준 %) */
  stop_loss_pct?: number | null;
  take_profit_pct?: number | null;
  /** 화면에 보이는 봉(state.season.current_day_index) — 서버 현재 봉과 다르면 409 STALE_DAY(새 캔들이 열림 → 상태 재조회) */
  day_index?: number;
}

export interface EduActionResponse {
  action: EduAction;
  account: EduAccount;
  bonus_cash_awarded: number;
  /** 연속 출석 일수(STREAK 꺼져 있으면 null) */
  streak: number | null;
  message: string;
}

export interface EduLeaderRow {
  rank: number;
  nickname: string | null;
  current_roi: number;
  total_asset: number;
  participation_days: number;
  win_trades: number;
  total_trades: number;
}

export interface EduLeaderboard {
  season_id: number;
  top: EduLeaderRow[];
  my_rank: EduLeaderRow | null;
}

export interface EduHistory {
  season_id: number;
  actions: EduAction[];
}

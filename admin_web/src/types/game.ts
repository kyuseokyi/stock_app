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

export interface SeasonOption {
  id: number
  season_number: number
  ticker: string
  stock_name: string
  status: string // READY | ACTIVE | FINISHED
  start_at: string
  end_at: string | null
}

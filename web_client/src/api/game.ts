import type { AxiosInstance } from 'axios'
import { gameClient } from './gameClient'
import { toNum, toNumOrNull } from '../lib/decimal'
import type {
  Account, Coach, MyRank, OrderRequest, OrderResult, Position, RawAccount, RawCoachMessage,
  RawCoachToday, RawOrderResult, RawPosition, Season,
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

/** 5배 레버리지 해금 여부(문항은 6b에서 사용) */
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

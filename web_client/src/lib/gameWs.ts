import { toNumOrNull } from './decimal'
import type { GameWsMessage, MarketStatus, MarketStatusState } from '../types/game'

// WS 원문(JSON 문자열) → 판별 유니온. 형식이 틀리거나 모르는 type 은 null(무시) —
// 백엔드에 새 메시지 type 이 추가돼도 기존 클라이언트가 깨지지 않게 한다.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export function parseGameMessage(raw: string): GameWsMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(data)) return null

  switch (data.type) {
    case 'tick': {
      const ticker = str(data.ticker)
      const price = toNumOrNull(data.price)
      return ticker !== null && price !== null ? { type: 'tick', ticker, price } : null
    }
    case 'position_pnl': {
      const id = str(data.position_id)
      const roi = toNumOrNull(data.roi_pct)
      const pnl = toNumOrNull(data.pnl_amount)
      return id !== null && roi !== null && pnl !== null
        ? { type: 'position_pnl', position_id: id, roi_pct: roi, pnl_amount: pnl }
        : null
    }
    case 'sentiment': {
      const long = toNumOrNull(data.long_pct)
      const short = toNumOrNull(data.short_pct)
      if (long === null || short === null) return null
      const total = toNumOrNull(data.total) // 신규 필드(선택) — 구 서버는 없음
      return total !== null
        ? { type: 'sentiment', long_pct: long, short_pct: short, total }
        : { type: 'sentiment', long_pct: long, short_pct: short }
    }
    case 'nudge': {
      const id = str(data.position_id)
      const n = data.nudge
      if (id === null || !isObj(n)) return null
      const type = str(n.type)
      const code = str(n.code)
      const message = str(n.message)
      return type !== null && code !== null && message !== null
        ? { type: 'nudge', position_id: id, nudge: { type, code, message } }
        : null
    }
    case 'coach': {
      const seasonId = toNumOrNull(data.season_id)
      const title = str(data.title)
      const summary = str(data.summary_nudge)
      if (seasonId === null || title === null || summary === null) return null
      return {
        type: 'coach',
        coach: {
          season_id: seasonId,
          coach_type: str(data.coach_type) ?? '',
          title,
          summary_nudge: summary,
          content_md: null, // WS 페이로드에는 본문이 없다
          support_price: toNumOrNull(data.support_price),
          resistance_price: toNumOrNull(data.resistance_price),
        },
      }
    }
    case 'market_status':
      return toMarketStatus(data)
    default:
      return null
  }
}

/** 장운영 상태 재조회 주기 — 서버는 해제 이벤트를 놓쳐도 최대 지속 시간이 지나면 정상으로 보지만 그 전환은 발행되지 않는다 */
export const MARKET_STATUS_POLL_MS = 20_000

/** 배너가 떠 있는 동안(정상이 아닐 때)만 재조회 — 평상시엔 요청하지 않는다 */
export const shouldPollMarketStatus = (status: MarketStatus | null): boolean =>
  status !== null && status.state !== 'NORMAL'

const MARKET_STATES = new Set(['NORMAL', 'HALTED', 'CIRCUIT_BREAKER', 'MARKET_PAUSED', 'VI', 'SIDECAR'])

/** REST·WS 공용 정규화 — 모르는 state 는 null(무시: 서버가 상태를 늘려도 화면이 깨지지 않게) */
export function toMarketStatus(data: unknown): ({ type: 'market_status' } & MarketStatus) | null {
  if (!isObj(data) || typeof data.state !== 'string' || !MARKET_STATES.has(data.state)) return null
  return {
    type: 'market_status',
    ticker: str(data.ticker),
    state: data.state as MarketStatusState,
    message: typeof data.message === 'string' ? data.message : '',
    blocking: data.blocking === true,
    since: str(data.since),
  }
}

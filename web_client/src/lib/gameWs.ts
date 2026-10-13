import { toNumOrNull } from './decimal'
import type { GameWsMessage } from '../types/game'

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
      return long !== null && short !== null ? { type: 'sentiment', long_pct: long, short_pct: short } : null
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
    default:
      return null
  }
}

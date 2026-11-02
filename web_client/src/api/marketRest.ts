import axios from 'axios'
import { STOCK_API_URL } from '../config'
import { normalizeInvestorFlow, normalizeMorningBrief, normalizeMovers } from '../lib/marketRest'
import { deriveStockApiUrl } from '../lib/stockApiUrl'
import type { InvestorFlow, MorningBrief, Movers } from '../types/marketRest'

// stock_api REST(마켓 AI, 공개 GET) — 응답은 lib/marketRest 로 모양을 맞춰 돌려준다.
// GraphQL 계약 파일(api/market.ts)과 분리: 그쪽은 백엔드 계약 테스트가 파일을 직접 읽는다.

const REST_BASE = STOCK_API_URL ? deriveStockApiUrl(STOCK_API_URL) : null

/** timeoutMs 를 주면 그 시간 안에 응답이 없을 때 실패 처리(자동 갱신이 멈춘 요청에 갇히지 않게) */
async function getJson(path: string, timeoutMs?: number): Promise<unknown> {
  if (REST_BASE === null) throw new Error('STOCK_API_URL 미설정')
  const { data } = await axios.get<unknown>(`${REST_BASE}${path}`, timeoutMs ? { timeout: timeoutMs } : undefined)
  return data
}

export async function getMorningBrief(timeoutMs?: number): Promise<MorningBrief | null> {
  return normalizeMorningBrief(await getJson('/api/v1/market/morning-brief', timeoutMs))
}

export async function getMovers(timeoutMs?: number): Promise<Movers> {
  return normalizeMovers(await getJson('/api/v1/market/movers', timeoutMs))
}

export async function getInvestorFlow(timeoutMs?: number): Promise<InvestorFlow> {
  return normalizeInvestorFlow(await getJson('/api/v1/market/investor-flow', timeoutMs))
}

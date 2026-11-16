import axios from 'axios'
import { STOCK_API_URL } from '../config'
import { LENDING_DAYS, normalizeLending } from '../lib/lending'
import { deriveStockApiUrl } from '../lib/stockApiUrl'
import type { LendingPoint } from '../types/lending'

// stock_api REST — 종목 대차잔고 추이(공개 GET). GraphQL 계약 파일과 분리(백엔드 계약 테스트가 그쪽 파일을 읽는다).

const REST_BASE = STOCK_API_URL ? deriveStockApiUrl(STOCK_API_URL) : null

export async function getLending(ticker: string, days = LENDING_DAYS): Promise<LendingPoint[]> {
  if (REST_BASE === null) throw new Error('STOCK_API_URL 미설정')
  const { data } = await axios.get<unknown>(`${REST_BASE}/api/v1/stocks/${encodeURIComponent(ticker)}/lending`, {
    params: { days },
  })
  return normalizeLending(data)
}

// web_client/src/api/screener.ts 복사본 — 원본과 같이 고칠 것 (변경: config 경로 → 관리자 src/config, 역대 신고가 nearAth)
import axios from 'axios'
import { STOCK_API_URL } from '../../config'
import type { CanslimItem, CanslimMarket, CanslimScore, CanslimScreen, ScreenFilters } from '../types/screener'

// stock_api GraphQL CANSLIM 조회(공개 — 로그인 불필요). api/stock 과 같은 axios POST 방식.

const ITEM_FIELDS = `ticker name market sectorName close score passCount liquid rs pctFromHigh
  letters { c a n s l i m }`

const SCREEN_QUERY = `query CanslimScreen($market: String!, $minPass: Int!, $required: [String!], $sort: String!,
  $liquidOnly: Boolean!, $limit: Int!, $offset: Int!, $nearAth: Boolean = false) {
  canslimMarket { market date status close ma50 ma200 distributionDays }
  canslimScreen(market: $market, minPass: $minPass, required: $required, sort: $sort, liquidOnly: $liquidOnly,
    limit: $limit, offset: $offset, nearAth: $nearAth) { date total items { ${ITEM_FIELDS} } }
}`

const SCORE_QUERY = `query CanslimScore($ticker: String!) {
  canslimScore(ticker: $ticker) {
    date ticker name market sectorName close score passCount marketStatus
    letters { key status value display threshold label explanation }
    history { date score passCount }
  }
}`

interface GqlResponse<T> {
  data?: T | null
  errors?: { message: string }[]
}

/** stock_api GraphQL POST — api/patterns 도 같이 쓴다 */
export async function gql<T>(query: string, variables: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL 미설정')
  const { data } = await axios.post<GqlResponse<T>>(STOCK_API_URL, { query, variables }, timeoutMs ? { timeout: timeoutMs } : undefined)
  if ((data.errors && data.errors.length > 0) || !data.data) throw new Error(data.errors?.[0]?.message ?? '응답 없음')
  return data.data
}

export const PAGE_SIZE = 50

/** 시장 상태 + 목록(첫 페이지 또는 offset 부터) */
export async function getCanslimScreen(
  f: ScreenFilters,
  offset = 0,
): Promise<{ markets: CanslimMarket[]; screen: CanslimScreen }> {
  const res = await gql<{ canslimMarket: CanslimMarket[]; canslimScreen: CanslimScreen }>(SCREEN_QUERY, {
    market: f.market,
    minPass: f.minPass,
    required: f.required,
    sort: f.sort,
    liquidOnly: f.liquidOnly,
    nearAth: f.nearAth,
    limit: PAGE_SIZE,
    offset,
  })
  return { markets: res.canslimMarket, screen: res.canslimScreen }
}

const BULK = 200 // 서버 MAX_LIMIT

/** 점수 높은 순으로 minScore 이상(유동성 통과 종목, 200개씩 최대 1000개) — '오늘 볼 10개' 후보. 같은 SCREEN_QUERY 를 변수만 바꿔 쓴다. */
export async function getCanslimAbove(minScore: number): Promise<{ date: string | null; items: CanslimItem[] }> {
  const items: CanslimItem[] = []
  let date: string | null = null
  for (let offset = 0; offset < 1000; offset += BULK) {
    const { canslimScreen } = await gql<{ canslimScreen: CanslimScreen }>(SCREEN_QUERY, {
      market: 'ALL', minPass: 0, required: [], sort: 'score', liquidOnly: true, limit: BULK, offset,
    })
    date = canslimScreen.date
    items.push(...canslimScreen.items)
    const last = canslimScreen.items[canslimScreen.items.length - 1]
    if (canslimScreen.items.length < BULK || !last || last.score < minScore) break
  }
  return { date, items }
}

/** 종목 점수표(분석 대상이 아니면 null) */
export async function getCanslimScore(ticker: string): Promise<CanslimScore | null> {
  const res = await gql<{ canslimScore: CanslimScore | null }>(SCORE_QUERY, { ticker })
  return res.canslimScore
}

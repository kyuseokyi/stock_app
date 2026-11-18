import { gql } from '../leaders/api/screener'

// 관리자 '5·20 정배열 스크리너' — 공용 GraphQL screenerScreen(공개, 로그인 불필요)을 부른다.
// 쿼리 문자열은 backend/tests/test_screener_contract.py 가 그대로 꺼내 실제 스키마로 실행한다(필드 이름 계약).

export type MaMode = 'MA5_20' | 'CLOSE_MA5_20' | 'PULLBACK_MA5_20' | 'PERFECT'
export type MaSort = 'value' | 'chg' | 'volume' | 'vol_ratio' | 'mcap' | 'spread_5_20'

/** screenerScreen 필터 입력(camelCase) — 빈 조건은 넣지 않는다 */
export interface MaScreenerFilterInput {
  market?: 'KOSPI' | 'KOSDAQ'
  liquidOnly: boolean
  maOrder: MaMode
  mcapMin?: number
  mcapMax?: number
  valueMin?: number
  valueMax?: number
  volumeMin?: number
  volumeMax?: number
  volRatioMin?: number
  chgMin?: number
  chgMax?: number
  ma5Ma20SpreadMin?: number
  ma5Ma20SpreadMax?: number
}

export interface MaScreenerItem {
  ticker: string
  name: string
  market: string
  sectorName: string | null
  close: number
  chg1d: number | null
  value: number // 거래대금(원)
  mcap: number | null // 시가총액(원)
  volRatio20: number | null
  rsi14: number | null
  maOrder: number
  vpAbovePct: number | null
  per: number | null
  pbr: number | null
  roe: number | null
  volume: number | null // 당일 거래량(주)
  ma5: number | null
  ma20: number | null
  ma50: number | null
  ma5Ma20SpreadPct: number | null
}

export interface MaScreenerResult {
  date: string | null
  total: number
  items: MaScreenerItem[]
}

export const MA_SCREENER_QUERY = `query MaScreener($filters: ScreenerFilterInput, $sort: String!, $limit: Int!, $offset: Int!) {
  screenerScreen(preset: "ma5_20", filters: $filters, sort: $sort, limit: $limit, offset: $offset) {
    date total
    items { ticker name market sectorName close chg1d value mcap volRatio20 rsi14 maOrder vpAbovePct per pbr roe
      volume ma5 ma20 ma50 ma5Ma20SpreadPct }
  }
}`

// 갱신 현황 카드용 — 최신 기준일에 계산된 전체 종목 수(유동성 조건 없이)
export const MA_SCREENER_STATUS_QUERY = `query MaScreenerStatus {
  screenerScreen(filters: { liquidOnly: false }, limit: 1) { date total }
}`

export const MA_PAGE_SIZE = 50

export async function getMaScreener(filters: MaScreenerFilterInput, sort: MaSort, offset = 0): Promise<MaScreenerResult> {
  const res = await gql<{ screenerScreen: MaScreenerResult }>(MA_SCREENER_QUERY, {
    filters,
    sort,
    limit: MA_PAGE_SIZE,
    offset,
  })
  return res.screenerScreen
}

export async function getScreenerDataset(): Promise<{ date: string | null; total: number }> {
  const res = await gql<{ screenerScreen: { date: string | null; total: number } }>(MA_SCREENER_STATUS_QUERY, {})
  return res.screenerScreen
}

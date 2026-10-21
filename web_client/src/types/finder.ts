// 조건검색(stock_api GraphQL screenerScreen) 타입 — 모바일 mobile/src/features/finder/types.ts 와 같다.
import type { MarketFilter } from './screener'

export type FinderPreset = 'volume_surge' | 'golden_cross' | 'oversold' | 'new_high'
export type FinderSort = 'value' | 'chg' | 'vol_ratio' | 'rsi' | 'mcap' | 'vp_above'
export type MaOrderFilter = 'PERFECT' | 'REVERSE'
export type BbPosition = 'ABOVE' | 'BELOW' | 'INSIDE'

/** 숫자 입력 필터 — 금액은 억 원, 비율은 %(거래량 비율은 배). 빈칸(null)이면 조건 없음 */
export type NumKey =
  | 'priceMin' | 'priceMax' | 'mcapMin' | 'mcapMax' | 'valueMin' | 'volRatioMin' | 'rsiMin' | 'rsiMax'
  | 'bbWidthMax' | 'vpAboveMax' | 'roeMin' | 'perMin' | 'perMax' | 'pbrMin' | 'pbrMax' | 'debtRatioMax'
  | 'salesGrowthMin'

export interface FinderChoices {
  market: MarketFilter
  liquidOnly: boolean
  maOrder: MaOrderFilter | null
  bbSigma: number // 1 · 1.5 · 2 · 2.5 · 3
  bbPosition: BbPosition | null
}

export type FinderFilters = FinderChoices & Record<NumKey, number | null>
/** 입력 중인 초안 — 숫자 칸은 글자 그대로 들고 [적용] 때 숫자로 바꾼다 */
export type FinderDraft = FinderChoices & Record<NumKey, string>

export interface FinderQuery {
  preset: FinderPreset | null
  sort: FinderSort
  filters: FinderFilters
}

export interface FinderItem {
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
  maOrder: number // 1 정배열 · -1 역배열 · 0 혼합
  isNewHigh: boolean
  gcDays: number | null
  vpAbovePct: number | null
  per: number | null
  pbr: number | null
  roe: number | null
  bbPosition: BbPosition | null
  bbWidthPct: number | null
}

export interface FinderScreen {
  date: string | null // null 이면 아직 계산 전(준비 중)
  total: number
  bbSigma: number
  items: FinderItem[]
}

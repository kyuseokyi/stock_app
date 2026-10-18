// CANSLIM 스크리너(stock_api GraphQL canslim*) 응답 타입.
// 항목 상태: 1 통과 · 0 미달 · -1 데이터 부족 · -2 준비 중

export type LetterKey = 'c' | 'a' | 'n' | 's' | 'l' | 'i' | 'm'
export type LetterStatus = 1 | 0 | -1 | -2

export type CanslimSort = 'score' | 'rs' | 'passCount'
export type MarketFilter = 'ALL' | 'KOSPI' | 'KOSDAQ'

export interface CanslimMarket {
  market: string
  date: string
  status: string // 상승 추세 | 조정 | 하락
  close: number
  ma50: number
  ma200: number
  distributionDays: number
}

export type CanslimLetters = Record<LetterKey, LetterStatus>

export interface CanslimItem {
  ticker: string
  name: string
  market: string
  sectorName: string | null
  close: number
  score: number
  passCount: number
  liquid: boolean
  letters: CanslimLetters
  rs: number | null
  pctFromHigh: number | null
}

export interface CanslimScreen {
  date: string | null // null 이면 아직 계산 전(준비 중)
  total: number
  items: CanslimItem[]
}

export interface CanslimLetter {
  key: LetterKey
  status: LetterStatus
  value: number | null
  display: string
  threshold: string
  label: string
  explanation: string
}

export interface CanslimHistoryPoint {
  date: string
  score: number
  passCount: number
}

export interface CanslimScore {
  date: string
  ticker: string
  name: string
  market: string
  sectorName: string | null
  close: number
  score: number
  passCount: number
  letters: CanslimLetter[]
  history: CanslimHistoryPoint[]
  marketStatus: string | null
}

export interface ScreenFilters {
  market: MarketFilter
  minPass: number
  required: LetterKey[]
  sort: CanslimSort
  liquidOnly: boolean
}

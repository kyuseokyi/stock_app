// web_client/src/types/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 '오늘 볼 10개'·상세 차트 패턴이 쓰는 타입만)
// 차트 패턴(stock_api GraphQL patternScreen) 타입 — 모바일과 같은 필드.

export type PatternKind = 'cup' | 'cup_with_handle' | 'double_bottom' | 'flat_base' | 'consolidation' | 'htf'

export interface PatternItem {
  ticker: string
  name: string
  market: string
  sectorName: string | null
  close: number
  patternType: string
  label: string
  stage: number
  pivot: number
  pivotDistPct: number | null
  depth: number
  length: number
  isActive: boolean
  breakoutDate: string | null
  breakoutPricePct: number | null
  breakoutVolPct: number | null
  daysSinceBreakout: number | null
}

export interface PatternScreen {
  date: string | null
  total: number
  items: PatternItem[]
}

export interface PatternPoint {
  role: string
  date: string | null
  price: number | null
}

export interface PatternBase {
  patternType: string
  label: string
  stage: number
  subcount: number
  totalcount: number
  rimDate: string | null
  lowDate: string | null
  lowPrice: number | null
  pivot: number
  depth: number
  length: number
  isActive: boolean
  isCurrent: boolean
  breakoutDate: string | null
  breakoutPricePct: number | null
  breakoutVolPct: number | null
  daysSinceBreakout: number | null
  priorUptrendPct: number | null
  confidence: number
  points: PatternPoint[]
}

export interface PatternZones {
  buyLow: number
  buyHigh: number
  stopLow: number
  stopHigh: number
}

export interface PatternBases {
  date: string | null
  ticker: string
  name: string
  close: number | null
  bases: PatternBase[]
  zones: PatternZones | null
}

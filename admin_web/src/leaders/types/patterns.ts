// web_client/src/types/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 '오늘 볼 10개'가 쓰는 타입만)
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

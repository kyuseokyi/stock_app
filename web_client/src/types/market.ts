// stock_api GraphQL 시장 탭(지수·테마·업종·일정) 응답 타입.

export type GroupKind = 'theme' | 'sector'
export type Period = '1d' | '5d' | '20d'
export type GroupSort = 'chg' | 'value'
export type TreemapSize = 'mcap' | 'value'

export interface MarketIndex {
  code: string
  name: string
  region: string // KR | US | FX
  date: string
  close: number
  chg1d: number | null
  spark: number[]
}

export interface MacroValue {
  seriesId: string
  name: string
  unit: string
  date: string
  value: number
  prev: number | null
}

export interface MarketOverview {
  indices: MarketIndex[]
  macro: MacroValue[]
}

export interface GroupItem {
  id: string
  name: string
  members: number
  chg: number | null
  value: number
  up: number
  down: number
  flat: number
  leader: { ticker: string; name: string; chg: number | null } | null
  rank: number
  streak: number
}

export interface GroupRanking {
  date: string | null
  total: number
  items: GroupItem[]
}

export interface TreemapStock {
  ticker: string // '' = 기타 묶음
  name: string
  chg: number | null
  size: number
}

export interface TreemapGroup {
  id: string
  name: string
  chg: number | null
  size: number
  stocks: TreemapStock[]
}

export interface Treemap {
  date: string | null
  groups: TreemapGroup[]
}

export interface GroupStock {
  ticker: string
  name: string
  close: number
  chg1d: number | null
  chg5d: number | null
  value: number
  mcap: number | null
  isLeader: boolean
  reason: string | null
}

export interface GroupDetail {
  kind: GroupKind
  id: string
  name: string
  description: string | null
  date: string
  chg1d: number | null
  chg5d: number | null
  chg20d: number | null
  value: number
  mcap: number
  up: number
  down: number
  flat: number
  rank: number
  history: { date: string; chg1d: number | null; rank: number }[]
  stocks: GroupStock[]
}

export interface CalendarEvent {
  date: string
  title: string
  category: string // 공모주 | 경제지표
  ticker: string | null
  name: string | null
  detail: string
}

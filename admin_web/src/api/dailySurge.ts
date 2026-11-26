import { stockAdminClient as http } from './client'

// 급등락·테마 분석 관리자 REST(관리자 JWT) — backend/apps/stock_api/routers/daily_surge_admin.py
// 설계: docs/superpowers/specs/2026-11-26-daily-surge-theme-analyzer-design.md
const BASE = '/api/v1/admin/market/daily-surge'

export type SurgeMode = 'surge' | 'plunge' | 'value' | 'surge_value' | 'plunge_value'
export type SurgeBand = 'all' | '10_15' | '15_25' | '25_30'
export type SurgeSort = 'change_rate' | 'trading_value' | 'volume' | 'change_price' | 'volume_ratio'
export type Direction = 'up' | 'down'
export type TimeSlot = 'pre' | 'intra' | 'post' | 'other'

export interface SurgeDate {
  date: string
  surge_count: number
  plunge_count: number
  value_count: number
  group_count: number
}

export interface DartItem {
  rcept_no: string
  rcept_dt: string
  title: string
  when: 'prev' | 'same'
  url: string
}

export interface StockTheme {
  id: number
  name: string
  /** 테마 구성 종목 수 */
  size: number
  /** 그날 같은 방향으로 함께 움직인 종목 수(묶음 없으면 0) */
  moved: number
  /** 테마 출처 — 'kiwoom' 이 기본, 키움 테마가 없는 종목만 'kis' 로 보충(옛 집계는 없음) */
  source?: string | null
}

export interface SurgeNote {
  text: string
  scope: 'stock' | 'theme'
  theme_name: string | null
}

export interface SurgeStock {
  date: string
  ticker: string
  name: string
  market: string
  close: number
  prev_close: number
  change_price: number
  change_rate: number
  volume: number
  volume_ratio: number | null
  trading_value: number
  is_surge: boolean
  is_plunge: boolean
  is_top_value: boolean
  surge_rank: number | null
  plunge_rank: number | null
  value_rank: number | null
  primary_theme_id: number | null
  primary_theme_name: string | null
  is_theme_leader: boolean
  dart_items: DartItem[]
  dart_keywords: string[]
  /** 소속 테마 최대 5개(함께 움직인 수 → 작은 테마 순). 2026-11-27 이전 집계는 빈 목록 */
  themes: StockTheme[]
  /** KIS 마스터 업종 이름 */
  sector_name: string | null
  note?: SurgeNote | null
}

export interface ThemeGroup {
  date: string
  theme_id: number
  theme_name: string
  direction: Direction
  stock_count: number
  avg_change_rate: number
  value_sum: number
  leader_ticker: string
  leader_name: string
  members: string[]
  theme_source: string
  note: string | null
  /** 테마 구성 종목 수(옛 집계는 null) */
  theme_size: number | null
}

export interface BoardRow {
  ticker: string
  name: string
  close: number
  change_rate: number
  trading_value: number
  in_group: boolean
  is_leader: boolean
}

export interface StockDetail {
  stock: SurgeStock
  notes: { stock: string | null; theme: string | null }
  group: ThemeGroup | null
  board: BoardRow[]
}

export interface ThemeDetail {
  group: ThemeGroup
  note: string | null
  board: BoardRow[]
}

export interface NewsItem {
  title: string
  url: string
  press_domain: string
  published_at: string | null
  time_slot: TimeSlot
}

export interface NewsResult {
  source: string
  query: string
  unavailable: boolean
  items: NewsItem[]
}

export interface ListParams {
  date: string
  mode: SurgeMode
  band?: SurgeBand
  market?: 'ALL' | 'KOSPI' | 'KOSDAQ'
  dart_only?: boolean
  sort?: SurgeSort
  order?: 'asc' | 'desc'
}

export interface ListResult {
  date: string
  theme_source: string | null
  items: SurgeStock[]
}

export const listDates = async (): Promise<SurgeDate[]> => (await http.get<SurgeDate[]>(`${BASE}/dates`)).data

export const listStocks = async (params: ListParams): Promise<ListResult> =>
  (await http.get<ListResult>(BASE, { params })).data

export const listGroups = async (date: string): Promise<ThemeGroup[]> =>
  (await http.get<ThemeGroup[]>(`${BASE}/groups`, { params: { date } })).data

export const getStockDetail = async (date: string, ticker: string): Promise<StockDetail> =>
  (await http.get<StockDetail>(`${BASE}/${date}/stocks/${encodeURIComponent(ticker)}`)).data

export const getThemeDetail = async (date: string, themeId: number, direction: Direction): Promise<ThemeDetail> =>
  (await http.get<ThemeDetail>(`${BASE}/${date}/themes/${themeId}`, { params: { direction } })).data

export const getNews = async (kind: 'stock' | 'theme', date: string, target: string): Promise<NewsResult> =>
  (await http.get<NewsResult>(`${BASE}/news`, { params: { kind, date, target } })).data

export const putNote = async (date: string, scope: 'stock' | 'theme', target: string, note: string): Promise<void> => {
  await http.put(`${BASE}/notes`, { date, scope, target, note })
}

export const deleteNote = async (date: string, scope: 'stock' | 'theme', target: string): Promise<void> => {
  await http.delete(`${BASE}/notes`, { params: { date, scope, target } })
}

export const rebuild = async (date: string): Promise<{ task_id: string; date: string }> =>
  (await http.post<{ task_id: string; date: string }>(`${BASE}/rebuild`, null, { params: { date } })).data

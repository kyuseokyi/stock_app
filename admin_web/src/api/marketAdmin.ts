import { stockAdminClient as http } from './client'
import type {
  AdminTheme,
  JobsOverview,
  MarketStatusReport,
  ThemeMetrics,
  ThemeStockRow,
  VerifyReport,
} from '../types/marketAdmin'

// stock_api 관리자 REST(관리자 JWT). 보정(생성·수정·추가·제외) 뒤 테마 순위 재계산은 서버가 맡는다.
const THEMES = '/api/v1/admin/themes'
const MARKET = '/api/v1/admin/market'

export const listThemes = async (): Promise<AdminTheme[]> => (await http.get<AdminTheme[]>(THEMES)).data

export const getThemeMetrics = async (): Promise<ThemeMetrics> =>
  (await http.get<ThemeMetrics>(`${THEMES}/metrics`)).data

export const createTheme = async (name: string, description: string | null): Promise<AdminTheme> =>
  (await http.post<AdminTheme>(THEMES, { name, description })).data

export const updateTheme = async (
  id: number,
  changes: Partial<Pick<AdminTheme, 'name' | 'description' | 'is_hidden'>>,
): Promise<AdminTheme> => (await http.patch<AdminTheme>(`${THEMES}/${id}`, changes)).data

export const listThemeStocks = async (id: number): Promise<ThemeStockRow[]> =>
  (await http.get<ThemeStockRow[]>(`${THEMES}/${id}/stocks`)).data

export const addThemeStock = async (id: number, ticker: string, reason: string | null): Promise<void> => {
  await http.post(`${THEMES}/${id}/stocks`, { ticker, reason })
}

export const excludeThemeStock = async (id: number, ticker: string): Promise<void> => {
  await http.delete(`${THEMES}/${id}/stocks/${encodeURIComponent(ticker)}`)
}

export const getMarketStatus = async (): Promise<MarketStatusReport> =>
  (await http.get<MarketStatusReport>(`${MARKET}/status`)).data

export const getJobs = async (): Promise<JobsOverview> => (await http.get<JobsOverview>(`${MARKET}/jobs`)).data

export const runJob = async (key: string): Promise<{ task_id: string; requested_at: string }> =>
  (await http.post<{ task_id: string; requested_at: string }>(`${MARKET}/jobs/${encodeURIComponent(key)}`)).data

export const getVerify = async (ticker: string, date?: string): Promise<VerifyReport> =>
  (await http.get<VerifyReport>(`${MARKET}/verify`, { params: date ? { ticker, date } : { ticker } })).data

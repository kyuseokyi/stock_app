import { stockAdminClient as http } from './client'

// stock_api 스크리너 탭 보이기 스위치(관리자 JWT). 웹·모바일은 GraphQL screenerFeatures 로 읽는다.
export type ScreenerFeatureKey = 'FINDER' | 'PATTERNS'

export interface ScreenerFeature {
  key: ScreenerFeatureKey
  enabled: boolean
  updated_at: string | null
}

const BASE = '/api/v1/admin/screener/features'

export const listScreenerFeatures = async (): Promise<ScreenerFeature[]> => (await http.get<ScreenerFeature[]>(BASE)).data

export const updateScreenerFeature = async (key: ScreenerFeatureKey, enabled: boolean): Promise<ScreenerFeature> =>
  (await http.put<ScreenerFeature>(`${BASE}/${key}`, { enabled })).data

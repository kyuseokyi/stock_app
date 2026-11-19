import { stockAdminClient as http } from './client'

// stock_api 스크리너 탭 보이기 스위치(관리자 JWT). 웹·모바일은 GraphQL screenerFeatures 로 읽는다.
// MARKET_DATA = 사용자 시세 노출 전체 스위치(A안) — 서버가 판정해 시세 API 를 막는다(기본 꺼짐)
// MARKET_INDEX_KR = 국내 지수(코스피·코스닥)만 공개 — MARKET_DATA 가 꺼져 있어도 지수 두 개만 연다(기본 꺼짐)
export type ScreenerFeatureKey = 'STOCK_FINDER' | 'FINDER' | 'PATTERNS' | 'MARKET_DATA' | 'MARKET_INDEX_KR'

export interface ScreenerFeature {
  key: ScreenerFeatureKey
  enabled: boolean
  updated_at: string | null
}

const BASE = '/api/v1/admin/screener/features'

export const listScreenerFeatures = async (): Promise<ScreenerFeature[]> => (await http.get<ScreenerFeature[]>(BASE)).data

export const updateScreenerFeature = async (key: ScreenerFeatureKey, enabled: boolean): Promise<ScreenerFeature> =>
  (await http.put<ScreenerFeature>(`${BASE}/${key}`, { enabled })).data

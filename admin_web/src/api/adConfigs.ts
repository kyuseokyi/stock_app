import client from './client'

// 광고 스위치·슬롯 설정 (blog /api/v1/admin/ads/config) — 명세 docs/ad_monetization_spec_and_plan.md §3-2

export type AdProvider = 'GOOGLE' | 'HOUSE'

export interface AdConfigIn {
  enabled: boolean
  provider: AdProvider
  infeed_interval: number
  house_title: string | null
  house_description: string | null
  house_target_path: string | null
}

export interface AdConfigOut extends AdConfigIn {
  slot_key: string
  updated_at: string | null // 서버에 행이 없어 기본값으로 응답하면 null
  updated_by: string | null
}

export const getAdConfigs = async (): Promise<AdConfigOut[]> => {
  const { data } = await client.get<AdConfigOut[]>('/admin/ads/config')
  return data
}

export const updateAdConfig = async (slotKey: string, payload: AdConfigIn): Promise<AdConfigOut> => {
  const { data } = await client.put<AdConfigOut>(`/admin/ads/config/${slotKey}`, payload)
  return data
}

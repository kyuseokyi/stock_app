import client from './client'

// blog 서비스 공개 광고 설정 GET /api/v1/ads/config(인증 없음, 서버가 no-store). 응답 = backend/apps/blog/ad_config_schemas.py
// PublicAdConfigOut. 긴급 끄기가 바로 반영되도록 화면에 들어올 때마다 다시 받는다(hooks/useAdConfig).

export type WebAdSlotKey = 'WEB_HOME_SIDEBAR' | 'WEB_POST_LIST_INFEED' | 'WEB_POST_DETAIL_BOTTOM' | 'WEB_SCREENER_FOOTER'

export interface AdSlot {
  enabled: boolean
  provider: 'GOOGLE' | 'HOUSE'
  infeed_interval: number
  house: { title: string | null; description: string | null; target_path: string | null }
}

export interface AdConfig {
  web_enabled: boolean
  mobile_enabled: boolean
  slots: Partial<Record<string, AdSlot>>
}

export async function getAdConfig(): Promise<AdConfig> {
  // client 의 baseURL 이 이미 …/api/v1 이다(blog.ts 와 같이 그 뒤 경로만)
  return (await client.get<AdConfig>('/ads/config')).data
}

import client from './client'

// 앱 버전 & 업데이트 정책 (blog /api/v1/admin/app-versions) — 명세 docs/app_update_management_spec.md §3-3

export type AppPlatform = 'android' | 'ios'
export type OtaPolicy = 'SILENT' | 'OPTIONAL' | 'MANDATORY'

export interface AppVersionIn {
  latest_version: string
  min_supported_version: string
  force_update_enabled: boolean
  store_url: string
  store_title: string
  store_message: string
  ota_policy: OtaPolicy
  ota_title: string | null
  ota_message: string | null
  is_maintenance: boolean
  maintenance_message: string | null
}

export interface AppVersionOut extends AppVersionIn {
  platform: AppPlatform
  updated_at: string | null // 서버에 행이 없어 기본값으로 응답하면 null
  updated_by: string | null
}

export const getAppVersions = async (): Promise<AppVersionOut[]> => {
  const { data } = await client.get<AppVersionOut[]>('/admin/app-versions')
  return data
}

export const updateAppVersion = async (platform: AppPlatform, payload: AppVersionIn): Promise<AppVersionOut> => {
  const { data } = await client.put<AppVersionOut>(`/admin/app-versions/${platform}`, payload)
  return data
}

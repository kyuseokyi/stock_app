import { blogApi } from '@/lib/api';

// blog 서비스 공개 광고 설정 GET /api/v1/ads/config(인증 없음, 서버가 no-store).
// 응답 = backend/apps/blog/ad_config_schemas.py PublicAdConfigOut(snake_case 그대로 — 판정 함수만 읽는다).

export type MobileAdSlotKey = 'MOB_HOME_FEED_NATIVE' | 'MOB_COMMUNITY_INFEED' | 'MOB_POST_DETAIL_BOTTOM';

export type AdSlot = {
  enabled: boolean;
  provider: 'GOOGLE' | 'HOUSE';
  infeed_interval: number;
  house: { title: string | null; description: string | null; target_path: string | null };
};

export type AdConfig = {
  web_enabled: boolean;
  mobile_enabled: boolean;
  slots: Partial<Record<string, AdSlot>>;
};

export function fetchAdConfig(): Promise<AdConfig> {
  return blogApi.get<AdConfig>('/api/v1/ads/config');
}

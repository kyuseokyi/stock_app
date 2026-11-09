import type { AdConfig, MobileAdSlotKey } from './api';

// 광고 슬롯 표시 판정(순수 함수, jest 로 검사). 명세 docs/ad_monetization_spec_and_plan.md §0·§1-2·§2.
// 지금은 하우스 배너만 그린다 — GOOGLE 을 골라도 AdMob 연동(네이티브 재빌드) 전까지 같은 하우스 배너로 대신한다.
// config === null 은 아직 답이 없거나 조회 실패 — 숨긴다(긴급 끄기가 목적이라 꺼짐 쪽이 안전). 규칙은 웹 lib/ads.ts 와 같다.

export type HouseAd = {
  title: string;
  description: string | null;
  targetPath: string;
};

/** 슬롯에 그릴 하우스 배너. 앱 전체 스위치·슬롯 스위치가 켜지고 제목·링크가 있을 때만, 아니면 null */
export function houseAdFor(config: AdConfig | null, key: MobileAdSlotKey): HouseAd | null {
  if (!config?.mobile_enabled) return null;
  const slot = config.slots[key];
  if (!slot?.enabled) return null;
  const title = slot.house.title?.trim();
  const targetPath = slot.house.target_path?.trim();
  // 서버는 HOUSE 일 때만 문구를 필수로 검증한다 — GOOGLE 인데 문구가 비었으면 그릴 것이 없다
  if (!title || !targetPath || !targetPath.startsWith('/')) return null;
  return { title, description: slot.house.description?.trim() || null, targetPath };
}

/** 목록 인피드 간격(서버 4~50). 이상한 값이면 기본 7 */
export function infeedInterval(config: AdConfig | null, key: MobileAdSlotKey): number {
  const n = config?.slots[key]?.infeed_interval;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 7;
}

/** 커뮤니티 목록 — interval 개마다 그 글 아래에 하나(명세 §1-2). index 는 0부터 */
export function isInfeedAfter(index: number, interval: number): boolean {
  return (index + 1) % interval === 0;
}

/** 홈 추천 글 — 3개 이상일 때만 목록 끝에 하나(명세 §1-2) */
export const HOME_FEED_MIN_POSTS = 3;

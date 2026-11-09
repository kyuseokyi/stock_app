import type { AdConfig, WebAdSlotKey } from '../api/ads'

// 광고 슬롯 표시 판정(순수 함수, vitest 로 검사). 명세 docs/ad_monetization_spec_and_plan.md §0·§2·§4-1.
// 지금은 하우스 배너만 그린다 — GOOGLE 을 골라도 AdSense 연동(상용 도메인) 전까지 같은 하우스 배너로 대신한다.
// config === null 은 아직 답이 없거나 조회 실패 — 숨긴다(긴급 끄기가 목적이라 꺼짐 쪽이 안전).

export interface HouseAd {
  title: string
  description: string | null
  targetPath: string
}

/** 슬롯에 그릴 하우스 배너. 웹 전체 스위치·슬롯 스위치가 켜지고 제목·링크가 있을 때만, 아니면 null */
export function houseAdFor(config: AdConfig | null, key: WebAdSlotKey): HouseAd | null {
  if (!config?.web_enabled) return null
  const slot = config.slots[key]
  if (!slot?.enabled) return null
  const title = slot.house.title?.trim()
  const targetPath = slot.house.target_path?.trim()
  // 서버는 HOUSE 일 때만 문구를 필수로 검증한다 — GOOGLE 인데 문구가 비었으면 그릴 것이 없다
  if (!title || !targetPath || !targetPath.startsWith('/')) return null
  return { title, description: slot.house.description?.trim() || null, targetPath }
}

/** 목록 인피드 간격(서버 4~50). 이상한 값이면 기본 5 */
export function infeedInterval(config: AdConfig | null, key: WebAdSlotKey): number {
  const n = config?.slots[key]?.infeed_interval
  return Number.isInteger(n) && (n as number) >= 1 ? (n as number) : 5
}

/** 웹 글 목록 — interval 번째 글 바로 뒤에 한 번만(글이 interval 개보다 적으면 넣지 않음). index 는 0부터 */
export function isInfeedAfter(index: number, count: number, interval: number): boolean {
  return count >= interval && index === interval - 1
}

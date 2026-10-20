import type { MarketIndex } from '../types/market'

/** 시장 탭 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000

/** 자동 새로고침 요청 제한 시간 — 응답 없이 멈춘 요청이 다음 주기를 막지 않게 */
export const MARKET_REQUEST_TIMEOUT_MS = 10_000

/**
 * 탭이 다시 보일 때 즉시 갱신할지 — 마지막 실행 후 주기 이상 지났을 때만(탭을 빠르게 오갈 때 중복 방지).
 * 한 번도 안 돌았거나 시계가 거꾸로 갔으면 즉시.
 */
export function shouldRefreshNow(lastAt: number | null, now: number, ms = MARKET_REFRESH_MS): boolean {
  return lastAt == null || now < lastAt || now - lastAt >= ms
}

/** 지수 카드 날짜 자리 — 장중이면 '장중 14:32'(live, 화면엔 좁은 폭을 위해 짧은 label '● 14:32'), 국내 확정이면 없음, 해외·환율은 M/D(기존 표기) */
export function indexBadge(
  ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>,
): { text: string; label: string; live: boolean } | null {
  if (ix.live && ix.asOf) return { text: `장중 ${ix.asOf}`, label: `● ${ix.asOf}`, live: true }
  if (ix.region === 'KR') return null
  const md = `${Number(ix.date.slice(5, 7))}/${Number(ix.date.slice(8, 10))}`
  return { text: md, label: md, live: false }
}

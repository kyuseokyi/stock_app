import type { MarketIndex } from '../types/market'

/** 시장 탭 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000

/** 지수 카드 날짜 자리 — 장중이면 '장중 14:32'(live), 국내 확정이면 없음, 해외·환율은 M/D(기존 표기) */
export function indexBadge(
  ix: Pick<MarketIndex, 'region' | 'date' | 'live' | 'asOf'>,
): { text: string; live: boolean } | null {
  if (ix.live && ix.asOf) return { text: `장중 ${ix.asOf}`, live: true }
  if (ix.region === 'KR') return null
  return { text: `${Number(ix.date.slice(5, 7))}/${Number(ix.date.slice(8, 10))}`, live: false }
}

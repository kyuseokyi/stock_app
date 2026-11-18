import type { FundEntry } from './fundCore'
import type { MarketIndex } from '../types/market'

// 홈 3단(내 펀드 → 블로그·게임 교육 → 시장 참고) 판정 — 순수 함수(docs/app_identity_and_nav_redesign_spec.md 2장).

/** 홈 내 펀드 카드에 한 번에 보여 줄 펀드 수 — 나머지는 '전체 보기'로 */
export const HOME_FUND_LIMIT = 3

export type HomeFundCardState =
  | { kind: 'guest' }
  | { kind: 'empty' }
  | { kind: 'funds'; funds: FundEntry[]; more: number }

/** 비로그인 → 로그인 안내 / 로그인 + 펀드 없음 → 등록 안내 / 펀드 있음 → 앞에서부터 HOME_FUND_LIMIT 개 + 남은 개수 */
export function homeFundCardState(uid: number | null, funds: FundEntry[]): HomeFundCardState {
  if (uid === null) return { kind: 'guest' }
  if (funds.length === 0) return { kind: 'empty' }
  return { kind: 'funds', funds: funds.slice(0, HOME_FUND_LIMIT), more: Math.max(0, funds.length - HOME_FUND_LIMIT) }
}

const KOSPI = 'KR:0001'
const KOSDAQ = 'KR:1001'

/**
 * 홈 하단 '오늘 시장 참고' — 코스피 · 코스닥 · 미국 대표 지수(US 첫 항목) · 원/달러(FX 첫 항목).
 * 없는 것은 건너뛴다(지어내지 않음). 홈 시장 노트의 noteIndices(미국 지수 없음)와는 별개.
 */
export function homeReferenceIndices(indices: MarketIndex[]): MarketIndex[] {
  const pick = [
    indices.find((i) => i.code === KOSPI),
    indices.find((i) => i.code === KOSDAQ),
    indices.find((i) => i.region === 'US'),
    indices.find((i) => i.region === 'FX'),
  ]
  return pick.filter((i): i is MarketIndex => i != null)
}

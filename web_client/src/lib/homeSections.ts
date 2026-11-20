import type { FundEntry } from './fundCore'
import { marketDataVisible, visibleIndices, type MarketAccessFlags } from './marketAccess'
import type { MacroValue, MarketIndex } from '../types/market'

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
/** 미국 대표 지수 우선순위 — S&P500 → 나스닥 종합 → 다우(backend collector/market_indices.py 의 코드) */
const US_HEADLINE = ['US:SPX', 'US:COMP', 'US:DJI']
const US_NOT_HEADLINE = ['US:VIX', 'US:SOX'] // 변동성·업종 지수는 '대표 지수'가 아니다

/**
 * 홈 하단 '오늘 시장 참고' — 코스피 · 코스닥 · 미국 대표 지수(S&P500 우선, 없으면 나스닥 종합·다우, 그것도 없으면 VIX·반도체를 뺀 US 첫 항목) · 원/달러(FX 첫 항목).
 * 없는 것은 건너뛴다(지어내지 않음). 홈 시장 노트의 noteIndices(미국 지수 없음)와는 별개.
 */
export function homeReferenceIndices(indices: MarketIndex[]): MarketIndex[] {
  const pick = [
    indices.find((i) => i.code === KOSPI),
    indices.find((i) => i.code === KOSDAQ),
    usHeadline(indices),
    indices.find((i) => i.region === 'FX'),
  ]
  return pick.filter((i): i is MarketIndex => i != null)
}

function usHeadline(indices: MarketIndex[]): MarketIndex | undefined {
  for (const code of US_HEADLINE) {
    const hit = indices.find((i) => i.code === code)
    if (hit) return hit
  }
  return indices.find((i) => i.region === 'US' && !US_NOT_HEADLINE.includes(i.code))
}

// ---------------------------------------------------------------- 오늘 시장 참고 — 시세 비노출(A안) 거시 카드
// 설계 docs/superpowers/specs/2026-11-19-market-data-off-plan-a-design.md 3-1·6절 4번(앱 mobile/src/features/home/home-sections.ts 와 같은 규칙)

/** 홈 거시 카드 3개(순서 고정) — 원/달러(한국은행 ECOS, 일별) · 미 국채 10년(FRED, 일별) · 미 기준금리(FRED 실효, 월별) */
export const HOME_MACRO_SERIES: readonly string[] = ['ECOS:USDKRW', 'DGS10', 'FEDFUNDS']
const HOME_MACRO_LABEL: Record<string, string> = {
  'ECOS:USDKRW': '원/달러 환율',
  DGS10: '미 10년물',
  FEDFUNDS: '미 기준금리',
}
const MONTHLY_SERIES = ['FEDFUNDS'] // 월 평균 값 — 날짜(01일)가 아니라 월로 보여 준다

/** 받은 거시 목록에서 홈 카드 3개만 정해진 순서로. 값이 없는 항목은 뺀다(지어내지 않음) */
export function homeMacroCards(macro: readonly MacroValue[]): MacroValue[] {
  return HOME_MACRO_SERIES.flatMap((s) => macro.filter((m) => m.seriesId === s).slice(0, 1))
}

export interface HomeMacroTile {
  seriesId: string
  label: string
  value: string
  /** '11.19 기준'(일별) · '10월 기준'(월별) — 카드마다 기준일이 다르다 */
  basis: string
}

/** 거시 카드 한 칸 표시 — 원은 천 단위 쉼표·소수 둘째 자리, % 는 소수 둘째 자리. 일별 값이라 '실시간' 문구는 넣지 않는다 */
export function homeMacroTile(m: MacroValue): HomeMacroTile {
  const value =
    m.unit === '원'
      ? `${m.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원`
      : `${m.value.toFixed(2)}${m.unit}`
  const [, mm = '', dd = ''] = m.date.split('-')
  const basis = MONTHLY_SERIES.includes(m.seriesId) ? `${Number(mm)}월 기준` : `${mm}.${dd.slice(0, 2)} 기준`
  return { seriesId: m.seriesId, label: HOME_MACRO_LABEL[m.seriesId] ?? m.name, value, basis }
}

/** 보이는 거시 카드의 출처 한 줄 — 없으면 null */
export function homeMacroSourceLine(cards: readonly Pick<MacroValue, 'seriesId'>[]): string | null {
  const src: string[] = []
  if (cards.some((c) => c.seriesId.startsWith('ECOS:'))) src.push('한국은행 경제통계시스템(ECOS)')
  if (cards.some((c) => !c.seriesId.startsWith('ECOS:'))) src.push('FRED')
  return src.length ? `출처: ${src.join(', ')}` : null
}

export type HomeReferenceView =
  | { mode: 'hidden' }
  /** 시세 열람(관리자·권한 회원·스위치 ON) — 지금 화면 그대로(지수 4칸, 거시 카드 없음) */
  | { mode: 'full'; indices: MarketIndex[] }
  /** 시세 비열람 — 국내 지수 공개면 코스피·코스닥 + 거시 카드(원/달러·미 10년물·미 기준금리) */
  | { mode: 'public'; indices: MarketIndex[]; macro: MacroValue[] }

/** 판단값을 모르면(null) 요청하지 않는다(기본 닫힘). 알면 시세 비열람이어도 거시 카드 때문에 요청한다 */
export function homeReferenceEnabled(flags: MarketAccessFlags | null | undefined): boolean {
  return flags != null
}

/**
 * 받은 개요 → 그릴 것. 시세 열람이면 지금과 같고(full), 아니면 국내 지수 공개일 때 코스피·코스닥 + 거시 카드,
 * 아니면 거시 카드만. 그릴 게 하나도 없으면 섹션째 숨김.
 */
export function homeReferenceView(
  flags: MarketAccessFlags | null | undefined,
  indices: MarketIndex[],
  macro: readonly MacroValue[],
): HomeReferenceView {
  if (!homeReferenceEnabled(flags)) return { mode: 'hidden' }
  const picked = visibleIndices(flags, homeReferenceIndices(indices))
  if (marketDataVisible(flags)) return { mode: 'full', indices: picked }
  const cards = homeMacroCards(macro)
  if (picked.length === 0 && cards.length === 0) return { mode: 'hidden' }
  return { mode: 'public', indices: picked, macro: cards }
}

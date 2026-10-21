// 조건검색 화면용 순수 함수 — 프리셋·정렬 상수, 기본 필터, 입력 변환, 적용 수, 같은 조건 비교, 배지 글자.
// 모바일 mobile/src/features/finder/finder.ts 와 같은 규칙이다(모바일 jest 가 고정 — 바꾸면 둘 다 바꿀 것).
import type {
  BbPosition,
  FinderDraft,
  FinderFilters,
  FinderPreset,
  FinderQuery,
  FinderSort,
  NumKey,
} from '../types/finder'

/** 한 번에 받는 개수(서버 MAX_LIMIT 200 이하) */
export const FINDER_PAGE = 50

/** 프리셋 — 키는 서버 screener_query.PRESETS 와 같은 문자열 */
export const PRESETS: { key: FinderPreset; label: string; description: string }[] = [
  { key: 'volume_surge', label: '거래량 급증', description: '오늘 거래량이 최근 20거래일 평균의 2배 이상인 종목' },
  { key: 'golden_cross', label: '골든크로스', description: '20일선이 60일선을 뚫고 올라선 지 3거래일 이내인 종목' },
  { key: 'oversold', label: '과매도', description: 'RSI(14)가 30 이하로 많이 떨어진 종목' },
  { key: 'new_high', label: '신고가', description: '오늘 고가가 직전 1년(52주) 최고가를 넘긴 종목' },
]

export const FINDER_SORTS: { key: FinderSort; label: string }[] = [
  { key: 'value', label: '거래대금' },
  { key: 'chg', label: '등락률' },
  { key: 'vol_ratio', label: '거래량 비율' },
  { key: 'rsi', label: 'RSI' },
  { key: 'mcap', label: '시가총액' },
  { key: 'vp_above', label: '위쪽 매물 적은 순' },
]

export const BB_SIGMAS = [1, 1.5, 2, 2.5, 3]

export const NUM_KEYS: NumKey[] = [
  'priceMin', 'priceMax', 'mcapMin', 'mcapMax', 'valueMin', 'volRatioMin', 'rsiMin', 'rsiMax', 'bbWidthMax',
  'vpAboveMax', 'roeMin', 'perMin', 'perMax', 'pbrMin', 'pbrMax', 'debtRatioMax', 'salesGrowthMin',
]

const EMPTY_NUMS = Object.fromEntries(NUM_KEYS.map((k) => [k, null])) as Record<NumKey, number | null>

export const DEFAULT_FINDER_FILTERS: FinderFilters = {
  market: 'ALL',
  liquidOnly: true,
  maOrder: null,
  bbSigma: 2,
  bbPosition: null,
  ...EMPTY_NUMS,
}

/** 입력 글자 → 숫자. 콤마·앞뒤 공백은 무시, 빈칸·숫자 아님·무한대는 null */
export function parseNum(text: string): number | null {
  const t = text.replace(/,/g, '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function toDraft(f: FinderFilters): FinderDraft {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, f[k] === null ? '' : String(f[k])])) as Record<NumKey, string>
  return { market: f.market, liquidOnly: f.liquidOnly, maOrder: f.maOrder, bbSigma: f.bbSigma, bbPosition: f.bbPosition, ...nums }
}

/** ROE·매출 성장률만 음수가 정상 값 — 나머지는 음수면 서버가 무시하므로 처음부터 조건으로 세지 않는다 */
const NEGATIVE_OK: NumKey[] = ['roeMin', 'salesGrowthMin']
/** 서버(screener_query._PAIRS)가 뒤집힌 범위는 둘 다 무시 — 같은 규칙 */
const PAIRS: [NumKey, NumKey][] = [['priceMin', 'priceMax'], ['mcapMin', 'mcapMax'], ['rsiMin', 'rsiMax'], ['perMin', 'perMax'], ['pbrMin', 'pbrMax']]

export function fromDraft(d: FinderDraft): FinderFilters {
  const nums = Object.fromEntries(
    NUM_KEYS.map((k) => {
      const n = parseNum(d[k])
      return [k, n !== null && n < 0 && !NEGATIVE_OK.includes(k) ? null : n]
    }),
  ) as Record<NumKey, number | null>
  for (const [lo, hi] of PAIRS) {
    const a = nums[lo]
    const b = nums[hi]
    if (a !== null && b !== null && a > b) {
      nums[lo] = null
      nums[hi] = null
    }
  }
  return { market: d.market, liquidOnly: d.liquidOnly, maOrder: d.maOrder, bbSigma: d.bbSigma, bbPosition: d.bbPosition, ...nums }
}

/** GraphQL ScreenerFilterInput 변수 — 빈 조건은 빼고, σ 는 볼린저 조건이 있을 때만 보낸다 */
export function toFilterInput(f: FinderFilters): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { market: f.market, liquidOnly: f.liquidOnly }
  if (f.maOrder) out.maOrder = f.maOrder
  if (f.bbPosition) out.bbPosition = f.bbPosition
  for (const k of NUM_KEYS) {
    const v = f[k]
    if (v !== null) out[k] = v
  }
  if (f.bbPosition || f.bbWidthMax !== null) out.bbSigma = f.bbSigma
  return out
}

/** 적용 중인 필터 수 — 시장(전체 아님)·거래 활발 끔·배열·볼린저 위치·숫자 칸마다 1. σ 만 바꾼 것·정렬·프리셋은 세지 않음 */
export function activeFilterCount(f: FinderFilters): number {
  let n = 0
  if (f.market !== 'ALL') n += 1
  if (!f.liquidOnly) n += 1
  if (f.maOrder) n += 1
  if (f.bbPosition) n += 1
  for (const k of NUM_KEYS) if (f[k] !== null) n += 1
  return n
}

/** 프리셋·정렬·필터가 모두 같으면 다시 조회할 필요가 없다 */
export function sameFinderQuery(a: FinderQuery, b: FinderQuery): boolean {
  if (a.preset !== b.preset || a.sort !== b.sort) return false
  const keys = Object.keys(a.filters) as (keyof FinderFilters)[]
  return keys.every((k) => a.filters[k] === b.filters[k])
}

export function sigmaLabel(s: number): string {
  return `${s}σ`
}

export function maOrderLabel(order: number): string | null {
  if (order === 1) return '정배열'
  if (order === -1) return '역배열'
  return null
}

export function gcLabel(days: number | null): string | null {
  if (days === null) return null
  return days === 0 ? '골든크로스 오늘' : `골든크로스 ${days}일 전`
}

export function bbPositionLabel(p: BbPosition | null): string {
  if (p === 'ABOVE') return '상단 돌파'
  if (p === 'BELOW') return '하단 이탈'
  if (p === 'INSIDE') return '밴드 안'
  return '–'
}

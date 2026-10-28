// web_client/src/lib/canslim.ts 복사본 — 원본과 같이 고칠 것
// CANSLIM 화면 표시용 순수 함수 — 항목 순서·배지 색·시장 상태 색·기본 필터.
import type { LetterKey, LetterStatus, ScreenFilters } from '../types/screener'

export const LETTER_KEYS: LetterKey[] = ['c', 'a', 'n', 's', 'l', 'i', 'm']

export const LETTER_NAMES: Record<LetterKey, string> = {
  c: '분기 실적',
  a: '연간 실적',
  n: '신고가',
  s: '거래량',
  l: '주도주',
  i: '기관·외국인',
  m: '시장',
}

export const DEFAULT_FILTERS: ScreenFilters = {
  market: 'ALL',
  minPass: 0,
  required: [],
  sort: 'score',
  liquidOnly: true,
}

/** 기본값과 다른 필터 수(모바일 '필터 · n개 적용' 표시) — 꼭 통과 항목은 하나씩 센다. 정렬은 필터가 아니라 세지 않음(앱 activeFilterCount 와 같음) */
export function activeCanslimFilters(f: ScreenFilters): number {
  const d = DEFAULT_FILTERS
  return (f.market !== d.market ? 1 : 0) + (f.minPass !== d.minPass ? 1 : 0)
    + f.required.length + (f.liquidOnly !== d.liquidOnly ? 1 : 0)
}

/** 배지 색: 통과=브랜드 블루, 미달=회색, 부족·준비 중=점선 테두리 */
export function letterBadgeClass(status: LetterStatus): string {
  if (status === 1) return 'bg-brand text-ink'
  if (status === 0) return 'ring-1 ring-inset ring-line text-ink-muted' // 미달 = 빈 테두리(통과 = 채움) — 색이 아니라 모양으로도 구분
  return 'border border-dashed border-line text-ink-muted'
}

export function letterStatusText(status: LetterStatus): string {
  if (status === 1) return '통과'
  if (status === 0) return '미달'
  if (status === -2) return '준비 중'
  return '데이터 부족'
}

/** 시장 상태 색(국내 관례 — 상승=빨강 계열, 하락=파랑 계열) */
export function marketToneClass(status: string): string {
  if (status === '상승 추세') return 'bg-up-soft text-up'
  if (status === '하락') return 'bg-down-soft text-down'
  return 'bg-fill text-ink'
}

/** 52주 최고가 — 서버의 '고점 대비 %'(N 값)와 종가로 되돌려 계산 */
export function high52w(close: number, pctFromHigh: number | null): number | null {
  if (pctFromHigh === null || pctFromHigh <= -100) return null
  return close / (1 + pctFromHigh / 100)
}

/** 필터 토글 — 반드시 통과할 항목 */
export function toggleRequired(required: LetterKey[], key: LetterKey): LetterKey[] {
  return required.includes(key) ? required.filter((k) => k !== key) : [...required, key]
}

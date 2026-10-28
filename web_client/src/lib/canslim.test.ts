import { describe, it, expect } from 'vitest'
import {
  activeCanslimFilters,
  DEFAULT_FILTERS,
  high52w,
  LETTER_KEYS,
  letterBadgeClass,
  letterStatusText,
  marketToneClass,
  toggleRequired,
} from './canslim'

// 앱 canslim.test.ts 이식. 웹에 없는 함수(목록 페이지·화면 상태·점수 추이·sameFilters·resolveTickerParam)는 제외.
// 색은 앱의 테마 키(pass/fail/none, up/down/flat) 대신 웹의 Tailwind 클래스로 확인한다.

describe('항목 표시', () => {
  it('항목 순서는 C A N S L I M', () => {
    expect(LETTER_KEYS.join('')).toBe('canslim')
  })
  it('상태 글자 — 통과·미달·준비 중·데이터 부족', () => {
    expect(letterStatusText(1)).toBe('통과')
    expect(letterStatusText(0)).toBe('미달')
    expect(letterStatusText(-2)).toBe('준비 중')
    expect(letterStatusText(-1)).toBe('데이터 부족')
  })
  it('배지 색 구분 — 통과 채움, 미달 빈 테두리, 부족·준비 중 점선', () => {
    expect(letterBadgeClass(1)).toBe('bg-brand text-ink')
    expect(letterBadgeClass(0)).toBe('ring-1 ring-inset ring-line text-ink-muted')
    expect(letterBadgeClass(-1)).toBe('border border-dashed border-line text-ink-muted')
    expect(letterBadgeClass(-2)).toBe(letterBadgeClass(-1))
  })
  it('시장 상태 색 — 상승 추세=up, 하락=down, 그 밖=중립', () => {
    expect(marketToneClass('상승 추세')).toBe('bg-up-soft text-up')
    expect(marketToneClass('하락')).toBe('bg-down-soft text-down')
    expect(marketToneClass('조정')).toBe('bg-fill text-ink')
    expect(marketToneClass('')).toBe('bg-fill text-ink')
  })
})

describe('52주 고점', () => {
  it('종가와 고점 대비 %로 되돌려 계산', () => {
    expect(high52w(90, -10)).toBeCloseTo(100)
    expect(high52w(100, 0)).toBe(100)
  })
  it('값이 없거나 -100% 이하면 null', () => {
    expect(high52w(100, null)).toBeNull()
    expect(high52w(100, -100)).toBeNull()
    expect(high52w(100, -150)).toBeNull()
  })
})

describe('필터', () => {
  it('기본값은 웹 DEFAULT_FILTERS 와 같다', () => {
    expect(DEFAULT_FILTERS).toEqual({ market: 'ALL', minPass: 0, required: [], sort: 'score', liquidOnly: true })
  })
  it('꼭 통과 항목 토글 — 없으면 뒤에 추가, 있으면 제거(원본 불변)', () => {
    const base = ['c' as const]
    expect(toggleRequired(base, 'l')).toEqual(['c', 'l'])
    expect(toggleRequired(base, 'c')).toEqual([])
    expect(base).toEqual(['c'])
  })
  it('적용 중인 필터 수 — 기본은 0', () => {
    expect(activeCanslimFilters(DEFAULT_FILTERS)).toBe(0)
  })
  it('적용 중인 필터 수 — 시장·최소 통과·거래 활발은 1씩, 꼭 통과는 고른 개수만큼', () => {
    expect(activeCanslimFilters({ ...DEFAULT_FILTERS, market: 'KOSDAQ' })).toBe(1)
    expect(activeCanslimFilters({ ...DEFAULT_FILTERS, minPass: 5 })).toBe(1)
    expect(activeCanslimFilters({ ...DEFAULT_FILTERS, liquidOnly: false })).toBe(1)
    expect(activeCanslimFilters({ ...DEFAULT_FILTERS, required: ['c', 'a', 'l'] })).toBe(3)
  })
  it('적용 중인 필터 수 — 정렬은 필터가 아니라 세지 않는다(앱 activeFilterCount 와 같음)', () => {
    expect(activeCanslimFilters({ ...DEFAULT_FILTERS, sort: 'rs' })).toBe(0)
    expect(
      activeCanslimFilters({ market: 'KOSPI', minPass: 3, required: ['n'], sort: 'passCount', liquidOnly: false }),
    ).toBe(4)
  })
})

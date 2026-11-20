import { describe, expect, it } from 'vitest'
import {
  HOME_FUND_LIMIT,
  homeFundCardState,
  homeMacroCards,
  homeMacroSourceLine,
  homeMacroTile,
  homeReferenceEnabled,
  homeReferenceIndices,
  homeReferenceView,
} from './homeSections'
import type { FundEntry } from './fundCore'
import type { MacroValue, MarketIndex } from '../types/market'

const fund = (id: string): FundEntry => ({ id, url: `https://fund.ivyro.net/${id}`, name: id })

describe('homeFundCardState (홈 내 펀드 카드 3상태)', () => {
  it('비로그인이면 펀드 목록과 상관없이 로그인 안내', () => {
    expect(homeFundCardState(null, [])).toEqual({ kind: 'guest' })
    expect(homeFundCardState(null, [fund('a')])).toEqual({ kind: 'guest' })
  })
  it('로그인 + 펀드 없음이면 등록 안내', () => {
    expect(homeFundCardState(7, [])).toEqual({ kind: 'empty' })
  })
  it('로그인 + 펀드 있음이면 앞에서부터 최대 3개와 남은 개수', () => {
    const one = homeFundCardState(7, [fund('a')])
    expect(one).toEqual({ kind: 'funds', funds: [fund('a')], more: 0 })
    const many = homeFundCardState(7, ['a', 'b', 'c', 'd', 'e'].map(fund))
    expect(many.kind).toBe('funds')
    if (many.kind === 'funds') {
      expect(many.funds.map((f) => f.id)).toEqual(['a', 'b', 'c'])
      expect(many.funds).toHaveLength(HOME_FUND_LIMIT)
      expect(many.more).toBe(2)
    }
  })
})

const ix = (code: string, region: string): MarketIndex => ({
  code, name: code, region, date: '2026-11-17', close: 1, chg1d: 0, spark: [], live: false, asOf: null,
})

describe('homeReferenceIndices (홈 시장 참고 지수)', () => {
  it('코스피 · 코스닥 · 미국 대표(S&P500 우선) · 원/달러 순서 — 응답 순서와 무관', () => {
    const all = [
      ix('US:VIX', 'US'), ix('US:SOX', 'US'), ix('FX:USDKRW', 'FX'), ix('KR:1001', 'KR'),
      ix('US:COMP', 'US'), ix('US:SPX', 'US'), ix('KR:0001', 'KR'),
    ]
    expect(homeReferenceIndices(all).map((i) => i.code)).toEqual(['KR:0001', 'KR:1001', 'US:SPX', 'FX:USDKRW'])
  })
  it('S&P500 이 없으면 나스닥 종합, 대표 지수가 모두 없으면 VIX·반도체는 고르지 않는다', () => {
    expect(homeReferenceIndices([ix('US:VIX', 'US'), ix('US:COMP', 'US')]).map((i) => i.code)).toEqual(['US:COMP'])
    expect(homeReferenceIndices([ix('US:VIX', 'US'), ix('US:SOX', 'US')])).toEqual([])
    expect(homeReferenceIndices([ix('US:VIX', 'US'), ix('US:NDX', 'US')]).map((i) => i.code)).toEqual(['US:NDX'])
  })
  it('없는 지수는 건너뛴다', () => {
    expect(homeReferenceIndices([ix('KR:0001', 'KR')]).map((i) => i.code)).toEqual(['KR:0001'])
    expect(homeReferenceIndices([])).toEqual([])
  })
})

const mv = (seriesId: string, value: number, unit: string, date: string): MacroValue => ({
  seriesId, name: seriesId, unit, date, value, prev: null,
})
const MACRO = [
  mv('UNRATE', 4.2, '%', '2026-10-01'),
  mv('FEDFUNDS', 4.33, '%', '2026-10-01'),
  mv('DGS10', 4.12, '%', '2026-11-18'),
  mv('ECOS:USDKRW', 1385.2, '원', '2026-11-19'),
]
const ALL_IX = [ix('KR:0001', 'KR'), ix('KR:1001', 'KR'), ix('US:SPX', 'US'), ix('FX:USDKRW', 'FX')]
const codes = (v: ReturnType<typeof homeReferenceView>) => (v.mode === 'hidden' ? null : v.indices.map((i) => i.code))
const series = (v: ReturnType<typeof homeReferenceView>) => (v.mode === 'public' ? v.macro.map((m) => m.seriesId) : null)

describe('홈 거시 카드(A안 — 원/달러 ECOS·미 10년물·미 기준금리)', () => {
  it('정해진 3개만 순서대로, 없는 것은 뺀다', () => {
    expect(homeMacroCards(MACRO).map((m) => m.seriesId)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS'])
    expect(homeMacroCards([MACRO[0], MACRO[2]]).map((m) => m.seriesId)).toEqual(['DGS10'])
    expect(homeMacroCards([])).toEqual([])
  })
  it('표시 — 원은 쉼표·소수 둘째, 일별은 MM.DD 기준, 기준금리(월별)는 월 기준', () => {
    expect(homeMacroTile(MACRO[3])).toEqual({ seriesId: 'ECOS:USDKRW', label: '원/달러 환율', value: '1,385.20원', basis: '11.19 기준' })
    expect(homeMacroTile(MACRO[2])).toMatchObject({ label: '미 10년물', value: '4.12%', basis: '11.18 기준' })
    expect(homeMacroTile(MACRO[1])).toMatchObject({ label: '미 기준금리', value: '4.33%', basis: '10월 기준' })
  })
  it('출처 한 줄 — 보이는 카드 기준', () => {
    expect(homeMacroSourceLine(homeMacroCards(MACRO))).toBe('출처: 한국은행 경제통계시스템(ECOS), FRED')
    expect(homeMacroSourceLine([{ seriesId: 'DGS10' }])).toBe('출처: FRED')
    expect(homeMacroSourceLine([{ seriesId: 'ECOS:USDKRW' }])).toBe('출처: 한국은행 경제통계시스템(ECOS)')
    expect(homeMacroSourceLine([])).toBeNull()
  })
})

describe('homeReferenceView (어떤 카드가 보이는가)', () => {
  it('판단값을 모르면 요청도 표시도 하지 않는다', () => {
    expect(homeReferenceEnabled(null)).toBe(false)
    expect(homeReferenceView(null, ALL_IX, MACRO)).toEqual({ mode: 'hidden' })
  })
  it('시세 열람이면 지금과 같다 — 지수 4칸, 거시 카드 없음', () => {
    const v = homeReferenceView({ marketData: true, marketIndexKr: false }, ALL_IX, MACRO)
    expect(v.mode).toBe('full')
    expect(codes(v)).toEqual(['KR:0001', 'KR:1001', 'US:SPX', 'FX:USDKRW'])
    expect(series(v)).toBeNull()
  })
  it('시세 비열람 + 국내 지수 공개 → 코스피·코스닥 + 거시 3개', () => {
    const v = homeReferenceView({ marketData: false, marketIndexKr: true }, ALL_IX, MACRO)
    expect(codes(v)).toEqual(['KR:0001', 'KR:1001'])
    expect(series(v)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS'])
  })
  it('시세 비열람 + 국내 지수 비공개 → 거시 카드만(받은 지수가 있어도 그리지 않음)', () => {
    expect(homeReferenceEnabled({ marketData: false, marketIndexKr: false })).toBe(true)
    const v = homeReferenceView({ marketData: false, marketIndexKr: false }, ALL_IX, MACRO)
    expect(codes(v)).toEqual([])
    expect(series(v)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS'])
  })
  it('시세 비열람인데 거시도 지수도 없으면 숨김', () => {
    expect(homeReferenceView({ marketData: false }, [], [MACRO[0]])).toEqual({ mode: 'hidden' })
  })
})

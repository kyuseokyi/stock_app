import { describe, expect, it } from 'vitest'
import { HOME_FUND_LIMIT, homeFundCardState, homeReferenceIndices } from './homeSections'
import type { FundEntry } from './fundCore'
import type { MarketIndex } from '../types/market'

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

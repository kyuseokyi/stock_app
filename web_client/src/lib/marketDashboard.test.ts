import { describe, expect, it } from 'vitest'
import type { MacroValue, MarketIndex } from '../types/market'
import { normalizeInvestorFlow, normalizeMovers } from './marketRest'
import { flowCaption, formatBasis, formatEok, formatShortDate, hasFlowData, indexHeaderBasis, marketSession, parseKst, splitOverview, tickerNames } from './marketDashboard'

describe('formatBasis (KST 기준 시각)', () => {
  it('오프셋 있는 ISO', () => {
    expect(formatBasis('2026-10-30T15:30:12+09:00')).toBe('10.30 15:30 기준')
    expect(formatBasis('2026-10-30T06:30:00Z')).toBe('10.30 15:30 기준')
  })
  it('오프셋 없는 문자열은 KST 로 본다', () => {
    expect(formatBasis('2026-10-30T09:05:00')).toBe('10.30 09:05 기준')
    expect(formatBasis('2026-10-30 23:59')).toBe('10.30 23:59 기준')
    expect(parseKst('2026-10-30T09:00:00')).toBe(Date.UTC(2026, 9, 30, 0, 0))
  })
  it('자정 넘김(UTC 전날 → KST 다음날)', () => {
    expect(formatBasis('2026-10-29T15:10:00Z')).toBe('10.30 00:10 기준')
  })
  it('읽을 수 없으면 null', () => {
    expect(formatBasis(null)).toBeNull()
    expect(formatBasis('어제')).toBeNull()
  })
})

describe('formatShortDate', () => {
  it("'YYYY-MM-DD' → 'MM.DD'", () => {
    expect(formatShortDate('2026-10-30')).toBe('10.30')
    expect(formatShortDate(null)).toBe('')
  })
})

describe('marketSession (장운영 뱃지)', () => {
  const kst = (iso: string) => new Date(`${iso}+09:00`)
  it('국내 지수 없으면 null', () => {
    expect(marketSession([{ region: 'US', live: false }], kst('2026-10-30T10:00:00'))).toBeNull()
  })
  it('장중 값이면 정규장', () => {
    expect(marketSession([{ region: 'KR', live: true }], kst('2026-10-30T10:00:00'))).toBe('정규장')
  })
  it('평일 09:00 전은 장 시작 전, 장 후·주말은 장마감', () => {
    const kr = [{ region: 'KR', live: false }]
    expect(marketSession(kr, kst('2026-10-30T08:10:00'))).toBe('장 시작 전') // 금
    expect(marketSession(kr, kst('2026-10-30T16:00:00'))).toBe('장마감')
    expect(marketSession(kr, kst('2026-10-31T08:10:00'))).toBe('장마감') // 토
  })
})

describe('formatEok (억 단위)', () => {
  it('부호·콤마', () => {
    expect(formatEok(123_456_000_000)).toBe('+1,235억')
    expect(formatEok(-5_600_000_000)).toBe('-56억')
  })
  it('1억 미만은 소수 한 자리, 0 은 부호 없음', () => {
    expect(formatEok(30_000_000)).toBe('+0.3억')
    expect(formatEok(-1_000_000)).toBe('0억')
    expect(formatEok(0)).toBe('0억')
  })
  it('1조 이상은 조', () => {
    expect(formatEok(1_234_000_000_000)).toBe('+1.2조')
    expect(formatEok(-999_960_000_000)).toBe('-1.0조')
  })
})

describe('indexHeaderBasis', () => {
  const kr = (over: Partial<{ date: string; live: boolean; asOf: string | null }> = {}) => ({
    region: 'KR', date: '2026-11-02', live: false, asOf: null, ...over,
  })
  const us = { region: 'US', date: '2026-11-03', live: false, asOf: null }

  it('장중이면 가장 늦은 시각을 지수 장중으로', () => {
    expect(indexHeaderBasis([kr({ live: true, asOf: '14:30' }), kr({ live: true, asOf: '14:32' }), us])).toBe('지수 장중 14:32 기준')
  })
  it('장중인데 시각을 모르면 시각 없이', () => {
    expect(indexHeaderBasis([kr({ live: true })])).toBe('지수 장중')
  })
  it('장 마감 후엔 그날 15:30, 미국 날짜는 쓰지 않는다', () => {
    expect(indexHeaderBasis([kr(), us])).toBe('지수 11.02 15:30 기준')
  })
  it('국내 지수가 없으면 null', () => {
    expect(indexHeaderBasis([us])).toBeNull()
    expect(indexHeaderBasis([])).toBeNull()
  })
})

describe('flowCaption', () => {
  it('기준일·출처', () => {
    expect(flowCaption({ date: '2026-10-30', source: 'pykrx' })).toBe('10.30 기준 · 출처 KRX(pykrx)')
    expect(flowCaption({ date: null, source: 'kis' })).toBe('출처 KIS')
    expect(flowCaption({ date: null, source: null })).toBeNull()
  })
})

describe('splitOverview', () => {
  const ix = (code: string, region: string) => ({ code, region }) as MarketIndex
  const m = (seriesId: string) => ({ seriesId }) as MacroValue
  it('지수 카드·돈의 흐름·그 밖의 지수·금리·경제지표로 빠짐없이 나눈다', () => {
    const r = splitOverview(
      [ix('US:SPX', 'US'), ix('KR:0001', 'KR'), ix('FX:USDKRW', 'FX'), ix('US:VIX', 'US'), ix('KR:2001', 'KR'), ix('US:DJI', 'US'), ix('FX:JPY', 'FX')],
      [m('CPI'), m('DGS2'), m('DGS10')],
    )
    expect(r.headline.map((i) => i.code)).toEqual(['KR:0001', 'US:SPX'])
    expect(r.flow.map((i) => i.code)).toEqual(['FX:USDKRW', 'US:VIX', 'FX:JPY'])
    expect(r.others.map((i) => i.code)).toEqual(['KR:2001', 'US:DJI'])
    expect(r.rates.map((x) => x.seriesId)).toEqual(['DGS10', 'DGS2'])
    expect(r.otherMacro.map((x) => x.seriesId)).toEqual(['CPI'])
  })
})

describe('tickerNames · hasFlowData', () => {
  it('급등락·수급에서 이름을 모은다', () => {
    const mv = normalizeMovers({ gainers: [{ ticker: 'A', stock_name: '가' }] })
    const fl = normalizeInvestorFlow({ foreign_top: [{ ticker: 'B', name: '나', net_amount: 1 }] })
    const names = tickerNames(mv, fl)
    expect(names.get('A')).toBe('가')
    expect(names.get('B')).toBe('나')
    expect(tickerNames(null, null).size).toBe(0)
    expect(hasFlowData(fl)).toBe(true)
    expect(hasFlowData(normalizeInvestorFlow(null))).toBe(false)
  })
})

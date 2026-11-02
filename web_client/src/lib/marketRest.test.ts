import { describe, expect, it } from 'vitest'
import { normalizeInvestorFlow, normalizeMorningBrief, normalizeMovers, num } from './marketRest'

describe('num', () => {
  it('유한한 숫자·숫자 문자열만 통과', () => {
    expect(num(1.5)).toBe(1.5)
    expect(num('2.5')).toBe(2.5)
    for (const v of [NaN, Infinity, 'abc', '', null, undefined, {}]) expect(num(v)).toBeNull()
  })
})

describe('normalizeMorningBrief', () => {
  it('brief 가 null·없음·헤드라인 빈 값이면 null', () => {
    expect(normalizeMorningBrief({ brief: null })).toBeNull()
    expect(normalizeMorningBrief(null)).toBeNull()
    expect(normalizeMorningBrief({})).toBeNull()
    expect(normalizeMorningBrief({ brief: { headline: '  ' } })).toBeNull()
  })
  it('필드를 camelCase 로 바꾸고 잘못된 섹터·체크포인트는 버린다', () => {
    expect(
      normalizeMorningBrief({
        brief: {
          date: '2026-10-30',
          headline: ' 나스닥 +1.4% ',
          us_market_summary: '빅테크 강세',
          kr_impact_summary: null,
          bullish_sectors: [{ sector: '반도체', reason: 'HBM' }, { reason: '섹터 없음' }, 'x'],
          bearish_sectors: 'oops',
          macro_checkpoints: ['환율 1,380원', 3, ''],
          created_at: '2026-10-30T08:30:00+09:00',
        },
      }),
    ).toEqual({
      date: '2026-10-30',
      headline: '나스닥 +1.4%',
      usMarketSummary: '빅테크 강세',
      krImpactSummary: '',
      bullishSectors: [{ sector: '반도체', reason: 'HBM' }],
      bearishSectors: [],
      macroCheckpoints: ['환율 1,380원'],
      createdAt: '2026-10-30T08:30:00+09:00',
    })
  })
})

describe('normalizeMovers', () => {
  it('빈 응답·이상한 값도 같은 모양', () => {
    const empty = { updatedAt: null, gainers: [], losers: [], keywords: [] }
    expect(normalizeMovers(null)).toEqual(empty)
    expect(normalizeMovers({ gainers: 'x', losers: null })).toEqual(empty)
  })
  it('ticker 없는 항목 제외, 숫자 아닌 가격은 null, reliability 는 허용값만, 원인 null 정상', () => {
    const m = normalizeMovers({
      updated_at: '2026-10-30T15:30:00+09:00',
      gainers: [
        { ticker: '005930', stock_name: '삼성전자', price: 71200, change_rate: 29.9, reason_summary: 'HBM 승인', category: '수주계약', reliability: '상', risk_warning: null },
        { ticker: '', stock_name: '빈 티커' },
        { ticker: '000660', price: 'NaN', change_rate: '12.5', reliability: '최상', reason_summary: null },
      ],
      losers: [],
      keywords: [{ keyword: '#HBM', background: '수요 급증', tickers: ['000660', 7] }, { keyword: '' }],
    })
    expect(m.gainers).toHaveLength(2)
    expect(m.gainers[0].stockName).toBe('삼성전자')
    expect(m.gainers[1]).toEqual({
      ticker: '000660', stockName: '000660', price: null, changeRate: 12.5, reasonSummary: null, category: null, reliability: null, riskWarning: null,
    })
    expect(m.keywords).toEqual([{ keyword: 'HBM', background: '수요 급증', tickers: ['000660'] }])
  })
  it('각 최대 10개', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ticker: String(i), change_rate: i }))
    expect(normalizeMovers({ gainers: many, losers: many }).gainers).toHaveLength(10)
  })
})

describe('normalizeInvestorFlow', () => {
  it('빈 응답도 같은 모양', () => {
    expect(normalizeInvestorFlow(undefined)).toEqual({
      date: null, source: null, foreignTop: [], institutionTop: [], pensionTop: [], doubleBuy: [], aiComment: null, updatedAt: null,
    })
  })
  it('금액이 숫자가 아니면 그 항목만 버리고, 출처는 허용값만', () => {
    const f = normalizeInvestorFlow({
      date: '2026-10-30',
      source: 'krx',
      foreign_top: [{ ticker: 'A', name: '가', net_amount: 1e9 }, { ticker: 'B', net_amount: 'x' }],
      double_buy: [{ ticker: 'C', foreign_amount: '1', institution_amount: 2 }, { ticker: 'D', foreign_amount: 1 }],
      ai_comment: '  ',
    })
    expect(f.source).toBeNull()
    expect(f.foreignTop).toEqual([{ ticker: 'A', name: '가', netAmount: 1e9 }])
    expect(f.doubleBuy).toEqual([{ ticker: 'C', name: 'C', foreignAmount: 1, institutionAmount: 2 }])
    expect(f.aiComment).toBeNull()
  })
})

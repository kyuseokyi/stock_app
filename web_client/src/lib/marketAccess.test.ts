import { describe, expect, it } from 'vitest'
import { gameVisible, indexVisible, KR_PUBLIC_INDEX_CODES, marketDataVisible, realMarketOf, stockLinkOutUrl, visibleIndices } from './marketAccess'

const ix = (code: string) => ({ code })
const ALL = ['KR:0001', 'KR:1001', 'KR:2001', 'US:SPX', 'FX:USDKRW', 'USSTK:AAPL'].map(ix)

describe('시세 비노출 화면 판정(A안)', () => {
  it('판단값을 모르거나(null) 조회 실패면 시세·지수·게임 모두 숨김', () => {
    expect(marketDataVisible(null)).toBe(false)
    expect(marketDataVisible({})).toBe(false)
    expect(visibleIndices(null, ALL)).toEqual([])
    expect(gameVisible(null)).toBe(false)
    expect(gameVisible(undefined)).toBe(false)
  })

  it('시세 열람(관리자·권한 회원·스위치 ON)은 지금과 같이 모든 지수', () => {
    const f = { marketData: true, marketIndexKr: true }
    expect(marketDataVisible(f)).toBe(true)
    expect(visibleIndices(f, ALL)).toEqual(ALL)
  })

  it('국내 지수 공개만 켜지면 코스피·코스닥만 — 코스피200·미국·환율·미국 종목은 숨김', () => {
    const f = { marketData: false, marketIndexKr: true }
    expect(marketDataVisible(f)).toBe(false)
    expect(visibleIndices(f, ALL).map((x) => x.code)).toEqual(['KR:0001', 'KR:1001'])
    expect(indexVisible(f, 'US:SPX')).toBe(false)
    expect(KR_PUBLIC_INDEX_CODES).toEqual(['KR:0001', 'KR:1001'])
  })

  it('둘 다 꺼지면 지수 없음', () => {
    expect(visibleIndices({ marketData: false, marketIndexKr: false }, ALL)).toEqual([])
  })

  it('게임은 시즌 features.real_market 이 true 일 때만 — 시즌 없음·필드 없음은 닫힘', () => {
    expect(realMarketOf({ features: { real_market: true } })).toBe(true)
    expect(realMarketOf({ features: { real_market: false } })).toBe(false)
    expect(realMarketOf({ features: {} })).toBe(false)
    expect(realMarketOf({})).toBe(false)
    expect(realMarketOf(null)).toBe(false)
    expect(gameVisible(true)).toBe(true)
    expect(gameVisible(false)).toBe(false)
  })
})

describe('종목 상세 링크아웃', () => {
  it('6자리 코드만 포털 종목 화면 주소, 그 밖은 null', () => {
    expect(stockLinkOutUrl('005930')).toBe('https://m.stock.naver.com/domestic/stock/005930/total')
    expect(stockLinkOutUrl('0059')).toBeNull()
    expect(stockLinkOutUrl('../x')).toBeNull()
  })
})

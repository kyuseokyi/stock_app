import { describe, expect, it } from 'vitest'
import type { ScreenerFeatures } from '../api/screenerFeatures'
import { stockTabGate, stockTabVisible } from './screenerFeatures'

const f = (stockFinder: boolean, finder: boolean, patterns: boolean): ScreenerFeatures => ({ stockFinder, finder, patterns })

describe('종목 찾기 노출 판정', () => {
  it('STOCK_FINDER 가 꺼지면 FINDER·PATTERNS 와 무관하게 모두 숨기고 시장 개요로 보낸다', () => {
    for (const fi of [true, false]) {
      for (const pa of [true, false]) {
        const x = f(false, fi, pa)
        for (const t of ['leaders', 'finder', 'patterns'] as const) {
          expect(stockTabVisible(x, t)).toBe(false)
          expect(stockTabGate(x, t)).toBe('/screener/market')
        }
      }
    }
  })

  it('STOCK_FINDER 가 켜지면 주도주는 항상, 꺼진 탭은 주도주로 보낸다', () => {
    const x = f(true, false, true)
    expect(stockTabVisible(x, 'leaders')).toBe(true)
    expect(stockTabGate(x, 'leaders')).toBe('ok')
    expect(stockTabVisible(x, 'finder')).toBe(false)
    expect(stockTabGate(x, 'finder')).toBe('/screener/leaders')
    expect(stockTabVisible(x, 'patterns')).toBe(true)
    expect(stockTabGate(x, 'patterns')).toBe('ok')
  })

  it('답을 받기 전(null)은 메뉴 숨김·라우트는 기다림', () => {
    expect(stockTabVisible(null, 'leaders')).toBe(false)
    expect(stockTabGate(null, 'leaders')).toBe('wait')
  })
})

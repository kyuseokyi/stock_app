import { describe, test, expect } from 'vitest'
import { SR_BB_COLOR, SR_MA20_COLOR, SR_MA5_COLOR, SR_POC_RESIST, SR_POC_SUPPORT, SR_PREV_HIGH_COLOR, SR_PREV_LOW_COLOR, srIndicatorLevels, srSwingLevels, touchedLevels, type IndicatorLevel } from './touchLevels'

const lv = (id: string, price: number): IndicatorLevel => ({ id, name: id, price, color: '#x' })

describe('touchedLevels(몸통 기준)', () => {
  // 오차: 50,000원 이상 = 호가 100, 그 아래 = 0.15%(49,950 → 약 74.9)
  const up = { open: 50_000, close: 51_000 } // 양봉 몸통 50,000~51,000
  const down = { open: 51_000, close: 50_000 } // 음봉도 같은 몸통

  test('몸통 안의 레벨은 관통으로 포함(양봉·음봉 같음)', () => {
    expect(touchedLevels(up, [lv('ma20', 50_500)]).map((l) => l.id)).toEqual(['ma20'])
    expect(touchedLevels(down, [lv('ma20', 50_500)]).map((l) => l.id)).toEqual(['ma20'])
  })
  test('오차 안이면 몸통 끝에 닿은 터치로 포함', () => {
    expect(touchedLevels(up, [lv('a', 49_950), lv('b', 51_100)]).map((l) => l.id)).toEqual(['a', 'b'])
  })
  test('몸통 밖이면 꼬리가 닿아도 제외(꼬리는 입력에 없음)', () => {
    expect(touchedLevels(up, [lv('a', 49_800), lv('b', 51_200)])).toEqual([])
  })
  test('값이 없거나 0 이하면 제외, 순서는 입력 그대로', () => {
    expect(touchedLevels(up, [lv('nan', NaN), lv('zero', 0), lv('bbUpper', 50_900), lv('poc', 50_100)]).map((l) => l.id))
      .toEqual(['bbUpper', 'poc'])
  })
  test('호가 반올림 가격이 같으면 먼저 온 것 하나', () => {
    expect(touchedLevels(up, [lv('poc', 50_520), lv('ma20', 50_530), lv('ma5', 50_700)]).map((l) => l.id)).toEqual(['poc', 'ma5'])
  })
  test('시가 = 종가(첫 틱)면 그 가격 ± 오차만', () => {
    expect(touchedLevels({ open: 50_000, close: 50_000 }, [lv('a', 50_100), lv('b', 50_101)]).map((l) => l.id)).toEqual(['a'])
  })
})

describe('srIndicatorLevels', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i) // 100..119

  test('POC → 5일선 → 20일선 → BB 상단 → BB 하단, 60일선·BB 중심 없음', () => {
    const got = srIndicatorLevels(closes, 105)
    expect(got.map((l) => l.id)).toEqual(['poc', 'ma5', 'ma20', 'bbUpper', 'bbLower'])
    expect(got[1]).toEqual({ id: 'ma5', name: '5일선', price: 117, color: SR_MA5_COLOR })
    expect(got[2]).toEqual({ id: 'ma20', name: '20일선', price: 109.5, color: SR_MA20_COLOR })
    expect(got[3].color).toBe(SR_BB_COLOR)
  })
  test('POC 색 — 마지막 종가 이상 주황, 아래 보라. null 이면 뺌', () => {
    expect(srIndicatorLevels(closes, 119)[0].color).toBe(SR_POC_RESIST)
    expect(srIndicatorLevels(closes, 118)[0].color).toBe(SR_POC_SUPPORT)
    expect(srIndicatorLevels(closes, null)[0].id).toBe('ma5')
  })
  test('기간이 모자라면 그 지표는 뺌', () => {
    expect(srIndicatorLevels([1, 2, 3, 4, 5], null).map((l) => l.id)).toEqual(['ma5'])
    expect(srIndicatorLevels([], 10)).toEqual([])
  })
})

describe('srSwingLevels', () => {
  const v = [100, 101, 102, 110, 100, 90, 100, 130, 100, 95, 100, 101, 102, 103]
  const bars = v.map((x) => ({ high: x, low: x }))
  test('전고점 위·아래, 전저점 아래·위 — 이름·고정 가격 표시', () => {
    expect(srSwingLevels(bars, 120)).toEqual([
      { id: 'prevHigh:130', name: '전고점', price: 130, color: SR_PREV_HIGH_COLOR, byPrice: true },
      { id: 'prevHigh:110', name: '전고점', price: 110, color: SR_PREV_HIGH_COLOR, byPrice: true },
      { id: 'prevLow:95', name: '전저점', price: 95, color: SR_PREV_LOW_COLOR, byPrice: true },
    ])
  })
})

import { describe, test, it, expect } from 'vitest'
import {
  orderSummary,
  RATIO_CHIPS,
  RATIO_MORE,
  STOP_LOSS_PCTS,
  TAKE_PROFIT_PCTS,
  isChipRatio,
  ratioLabel,
  slTpHint,
  slTpLine,
  stopLossLabel,
  takeProfitLabel,
} from './orderOptions'

describe('선택지 상수', () => {
  test('비중: 칩 25/50/100 + 기타 10~90(칩과 겹치지 않음)', () => {
    expect(RATIO_CHIPS).toEqual([0.25, 0.5, 1.0])
    expect(RATIO_MORE).toEqual([0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.75, 0.8, 0.9])
    expect(RATIO_MORE.some((r) => RATIO_CHIPS.includes(r))).toBe(false)
  })
  test('손절·익절 선택지', () => {
    expect(STOP_LOSS_PCTS).toEqual([0.03, 0.05, 0.1, 0.15, 0.2])
    expect(TAKE_PROFIT_PCTS).toEqual([0.05, 0.1, 0.2, 0.3, 0.5])
  })
})

describe('라벨', () => {
  test('비중 %', () => {
    expect(ratioLabel(0.1)).toBe('10%')
    expect(ratioLabel(0.75)).toBe('75%')
    expect(ratioLabel(1.0)).toBe('100%')
  })
  test('칩 여부', () => {
    expect(isChipRatio(0.25)).toBe(true)
    expect(isChipRatio(0.3)).toBe(false)
  })
  test('손절/익절 부호·없음', () => {
    expect(stopLossLabel(null)).toBe('없음')
    expect(stopLossLabel(0.05)).toBe('-5%')
    expect(stopLossLabel(0.15)).toBe('-15%')
    expect(takeProfitLabel(null)).toBe('없음')
    expect(takeProfitLabel(0.3)).toBe('+30%')
  })
})

describe('slTpHint (주가 기준 → 배율 반영 수익률)', () => {
  test('미설정', () => {
    expect(slTpHint(null, null, 2)).toBe('손절·익절 %는 진입가 대비 주가 변동 기준이에요')
  })
  test('배율 곱한 수익률(약)', () => {
    expect(slTpHint(0.05, 0.1, 2)).toBe('주가 기준 · 2x 수익률 손절 약 -10% / 익절 약 +20%')
    expect(slTpHint(0.03, null, 5)).toBe('주가 기준 · 5x 수익률 손절 약 -15%')
    expect(slTpHint(null, 0.05, 1)).toBe('주가 기준 · 1x 수익률 익절 약 +5%')
  })
  test('손절 × 배율 ≥ 80% 면 강제청산 먼저 경고', () => {
    expect(slTpHint(0.2, null, 5)).toBe('5x에선 주가 -20% 전에 강제청산(수익률 -80%)이 먼저 일어나요')
    expect(slTpHint(0.15, null, 5)).toBe('주가 기준 · 5x 수익률 손절 약 -75%')
  })
})

describe('slTpLine (포지션 카드)', () => {
  test('둘 다 없으면 null', () => {
    expect(slTpLine(null, null)).toBeNull()
  })
  test('한쪽만 있으면 — 표시', () => {
    expect(slTpLine(67640, null)).toBe('손절 67,640원 · 익절 —')
    expect(slTpLine(null, 78100.4)).toBe('손절 — · 익절 78,100원')
  })
})

describe('하단 주문바 요약', () => {
  it('비중 · 배율 · 손절 · 익절 한 줄', () => {
    expect(orderSummary(0.25, 1, null, null)).toBe('25% · 1x · 손절 없음 · 익절 없음')
    expect(orderSummary(0.75, 2, 0.05, 0.1)).toBe('75% · 2x · 손절 -5% · 익절 +10%')
  })
})

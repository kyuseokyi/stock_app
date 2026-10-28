import { describe, test, expect } from 'vitest'
import { toNum, toNumOrNull } from './decimal'

describe('toNumOrNull', () => {
  test('Decimal 문자열 → number', () => {
    expect(toNumOrNull('71200.50')).toBe(71200.5)
  })
  test('유한 number 는 그대로', () => {
    expect(toNumOrNull(-3)).toBe(-3)
  })
  test('빈 문자열·공백·NaN·Infinity·null·객체 → null', () => {
    expect(toNumOrNull('')).toBeNull()
    expect(toNumOrNull('  ')).toBeNull()
    expect(toNumOrNull('abc')).toBeNull()
    expect(toNumOrNull(Number.NaN)).toBeNull()
    expect(toNumOrNull(Number.POSITIVE_INFINITY)).toBeNull()
    expect(toNumOrNull(null)).toBeNull()
    expect(toNumOrNull({})).toBeNull()
  })
})

describe('toNum', () => {
  test('변환 성공', () => {
    expect(toNum('10000000.00')).toBe(10000000)
  })
  test('변환 불가면 예외', () => {
    expect(() => toNum(null)).toThrow('숫자 변환 실패')
  })
})

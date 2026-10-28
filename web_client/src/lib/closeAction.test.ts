import { describe, test, expect } from 'vitest'
import { closeActionOf } from './closeAction'

describe('closeActionOf', () => {
  test('이익(0 포함)은 익절', () => {
    expect(closeActionOf(12_000)).toEqual({ kind: 'tp', label: '💰 익절하기' })
    expect(closeActionOf(0)).toEqual({ kind: 'tp', label: '💰 익절하기' })
  })
  test('손실은 손절', () => {
    expect(closeActionOf(-1)).toEqual({ kind: 'sl', label: '🛡️ 손절하기' })
  })
  test('손익 모름(틱 전)은 중립', () => {
    expect(closeActionOf(null)).toEqual({ kind: 'neutral', label: '청산하기' })
  })
})

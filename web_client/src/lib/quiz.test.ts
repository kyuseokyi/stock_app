import { describe, test, expect } from 'vitest'
import { isQuizPrimeTime, quizChoiceText, quizQuestionText, quizSecondsLeft } from './quiz'

describe('isQuizPrimeTime (KST)', () => {
  test('평일 15:29 → false, 15:30 → true', () => {
    // 2026-10-13(화) KST 15:29 = UTC 06:29
    expect(isQuizPrimeTime(new Date('2026-10-13T06:29:00Z'))).toBe(false)
    expect(isQuizPrimeTime(new Date('2026-10-13T06:30:00Z'))).toBe(true)
  })
  test('평일 23:59 → true, 다음 날 00:00(평일) → false', () => {
    expect(isQuizPrimeTime(new Date('2026-10-13T14:59:00Z'))).toBe(true)
    expect(isQuizPrimeTime(new Date('2026-10-13T15:00:00Z'))).toBe(false) // KST 10-14(수) 00:00
  })
  test('토/일 종일 → true', () => {
    expect(isQuizPrimeTime(new Date('2026-10-17T01:00:00Z'))).toBe(true) // KST 토 10:00
    expect(isQuizPrimeTime(new Date('2026-10-18T01:00:00Z'))).toBe(true) // KST 일 10:00
  })
})

describe('quizSecondsLeft', () => {
  test('시작 순간 = limit, 정확히 limit 경과 = 0', () => {
    expect(quizSecondsLeft(1000, 10, 1000)).toBe(10)
    expect(quizSecondsLeft(1000, 10, 11000)).toBe(0)
  })
  test('올림 — 0.1초 남으면 1', () => {
    expect(quizSecondsLeft(0, 10, 9900)).toBe(1)
    expect(quizSecondsLeft(0, 10, 200)).toBe(10)
  })
  test('초과는 0', () => {
    expect(quizSecondsLeft(0, 10, 99999)).toBe(0)
  })
})

describe('quizQuestionText', () => {
  test('유형·예측 기간별 문구', () => {
    expect(quizQuestionText({ quiz_type: 'DIRECTION', horizon_bars: 3 })).toBe('3거래일 뒤 주가는?')
    expect(quizQuestionText({ quiz_type: 'RANGE', horizon_bars: 10 })).toBe('10거래일 뒤 등락률은?')
    expect(quizQuestionText({ quiz_type: 'PATTERN', horizon_bars: 5 })).toBe('마지막 봉에 나타난 신호는?')
  })
})

describe('quizChoiceText', () => {
  const choices = [
    { code: 'GOLDEN_CROSS', label: '골든크로스' },
    { code: 'VOLUME_SURGE', label: '거래량 급증' },
  ]
  test('2지선다 코드 → 상승/하락', () => {
    expect(quizChoiceText([], 'UP')).toBe('📈 상승')
    expect(quizChoiceText([], 'DOWN')).toBe('📉 하락')
  })
  test('4지선다 코드 → 보기 label, 모르는 코드는 그대로', () => {
    expect(quizChoiceText(choices, 'VOLUME_SURGE')).toBe('거래량 급증')
    expect(quizChoiceText(choices, 'R_UP')).toBe('R_UP')
  })
})

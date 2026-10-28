import { describe, it, expect } from 'vitest'
import { breakoutText, PATTERN_KINDS, PATTERN_REPORTS, patternLabel, stageLabel } from './patterns'

// 앱 patterns.test.ts 이식. 웹 patterns.ts 는 화면 구성이 달라 상수 이름·문구 형식이 다르다.
// 웹에 없는 것(reportDescription·samePatternQuery·togglePatternType·pivotDistPct·currentBase·patternChartLines)은 제외.

describe('차트 패턴 순수 함수', () => {
  it('리포트·패턴 상수와 한국어 라벨', () => {
    expect(PATTERN_REPORTS.map((r) => r.label)).toEqual(['형성 중', '피벗 근접', '오늘 돌파', '최근 돌파 20일'])
    // 웹 칩 목록은 맨 앞에 '전체'(key null)가 있다
    expect(PATTERN_KINDS.map((p) => p.label)).toEqual([
      '전체',
      '컵',
      '컵핸들',
      '쌍바닥',
      '플랫 베이스',
      '박스권',
      '하이 타이트 플래그(HTF)',
    ])
    expect(patternLabel('cup_with_handle')).toBe('컵핸들')
    expect(patternLabel('unknown')).toBe('unknown')
  })

  it('단계 표기 — 라벨이 단계 숫자와 다르면 덧붙인다(웹은 가운뎃점)', () => {
    expect(stageLabel(1, '1')).toBe('1단계')
    expect(stageLabel(2, '2a')).toBe('2단계 · 2a')
    expect(stageLabel(3, '')).toBe('3단계')
  })

  it('돌파 문구 — 돌파 전이면 null, 날짜·경과일·거래량 한 줄', () => {
    expect(breakoutText(null, null, null)).toBeNull()
    expect(breakoutText('2026-10-13', 0, null)).toBe('10-13 돌파 (오늘)')
    expect(breakoutText('2026-10-13', 3, 120.4)).toBe('10-13 돌파 (3일 전) · 거래량 +120%')
    expect(breakoutText('2026-10-13', null, null)).toBe('10-13 돌파')
  })
})

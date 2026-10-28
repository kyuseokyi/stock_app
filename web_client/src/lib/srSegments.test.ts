import { describe, expect, it } from 'vitest'
import { SEG_AFTER, SEG_BEFORE, segmentSpan } from './srSegments'

describe('segmentSpan', () => {
  it('캔들이 없으면 null', () => {
    expect(segmentSpan(0)).toBeNull()
  })
  it('현재 캔들 앞 SEG_BEFORE 봉 ~ 뒤 SEG_AFTER 봉', () => {
    expect(segmentSpan(100)).toEqual({ from: 99 - SEG_BEFORE, to: 99 + SEG_AFTER })
  })
  it('캔들이 적으면 첫 캔들부터', () => {
    expect(segmentSpan(3)).toEqual({ from: 0, to: 2 + SEG_AFTER })
  })
})

import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('조건부 클래스를 합친다', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c')
  })
  it('충돌하는 Tailwind 클래스는 뒤의 것을 남긴다', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })
  it('우리 토큰 색도 같은 그룹으로 병합한다', () => {
    expect(cn('bg-surface', 'bg-fill')).toBe('bg-fill')
  })
})

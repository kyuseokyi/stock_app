import { describe, expect, it } from 'vitest'
import { sectionOf, visibleSections } from './navSections'

describe('visibleSections (스위치 → 메뉴 노출)', () => {
  const on = { stockFinder: true, finder: false, patterns: false }
  const off = { stockFinder: false, finder: true, patterns: true }
  it('켜져 있으면 스크리너를 보인다', () => {
    expect(visibleSections(on)).toEqual(['home', 'market', 'screener', 'community', 'game', 'me'])
  })
  it('꺼져 있거나 아직 모르면(null) 숨기고, 마켓은 항상 보인다', () => {
    for (const f of [off, null]) {
      expect(visibleSections(f)).toEqual(['home', 'market', 'community', 'game', 'me'])
    }
  })
})

describe('sectionOf', () => {
  it('메뉴별 경로', () => {
    expect(sectionOf('/')).toBe('home')
    expect(sectionOf('/market')).toBe('market')
    expect(sectionOf('/market/themes')).toBe('market')
    expect(sectionOf('/stock/005930')).toBe('market')
    expect(sectionOf('/screener/leaders')).toBe('screener')
    expect(sectionOf('/boards/1')).toBe('community')
    expect(sectionOf('/posts/1')).toBe('community')
    expect(sectionOf('/community')).toBe('community')
    expect(sectionOf('/game')).toBe('game')
    expect(sectionOf('/me/funds')).toBe('me')
  })
  it('어느 메뉴에도 속하지 않으면 null', () => {
    expect(sectionOf('/auth/complete')).toBeNull()
    expect(sectionOf('/marketing')).toBeNull()
  })
})

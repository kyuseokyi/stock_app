import { describe, expect, it } from 'vitest'
import { sectionOf, visibleSections } from './navSections'

describe('visibleSections (스위치 → 메뉴 노출)', () => {
  const on = { stockFinder: true, finder: false, patterns: false }
  const off = { stockFinder: false, finder: true, patterns: true }
  it('켜져 있으면 기본 5탭 뒤(시장 옆)에 스크리너를 보인다', () => {
    expect(visibleSections(on)).toEqual(['home', 'funds', 'community', 'game', 'market', 'screener'])
  })
  it('꺼져 있거나 아직 모르면(null) 기본 5탭 — 홈 · 내 펀드 · 블로그 · 게임 · 시장', () => {
    for (const f of [off, null]) {
      expect(visibleSections(f)).toEqual(['home', 'funds', 'community', 'game', 'market'])
    }
  })
  it('내정보는 탭에 없다(헤더 우측 버튼으로 이동)', () => {
    expect(visibleSections(on)).not.toContain('me')
    expect(visibleSections(null)).not.toContain('me')
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
  })
  it('내 펀드 목록·리포트는 내 펀드 탭, 나머지 /me 는 me', () => {
    expect(sectionOf('/me/funds')).toBe('funds')
    expect(sectionOf('/me/funds/abc')).toBe('funds')
    expect(sectionOf('/me')).toBe('me')
    expect(sectionOf('/me/blocks')).toBe('me')
  })
  it('어느 메뉴에도 속하지 않으면 null', () => {
    expect(sectionOf('/auth/complete')).toBeNull()
    expect(sectionOf('/marketing')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { sectionOf, visibleSections } from './navSections'

describe('visibleSections (스위치 → 메뉴 노출)', () => {
  const on = { stockFinder: true, finder: false, patterns: false, marketData: true, marketIndexKr: true }
  const off = { stockFinder: false, finder: true, patterns: true, marketData: true, marketIndexKr: true }
  const noMarket = { stockFinder: true, finder: true, patterns: true, marketData: false, marketIndexKr: true }
  it('켜져 있으면 기본 5탭 뒤(시장 옆)에 스크리너를 보인다', () => {
    expect(visibleSections(on, true, null, true)).toEqual(['home', 'funds', 'community', 'game', 'market', 'screener'])
  })
  it('꺼져 있거나 아직 모르면(null) 기본 5탭 — 홈 · 내 펀드 · 블로그 · 게임 · 시장', () => {
    for (const f of [off, null]) {
      expect(visibleSections(f, true, null, true)).toEqual(['home', 'funds', 'community', 'game', 'market'])
    }
  })
  it('시세 비노출이면 종목 찾기 스위치와 무관하게 스크리너를 숨긴다(A안)', () => {
    expect(visibleSections(noMarket, true, null, true)).toEqual(['home', 'funds', 'community', 'game', 'market'])
  })
  it('스위치 ON 이면 게임은 실제 시세 게임 허용(real_market=true)일 때만 — 거짓·모름(null)은 숨김(A안)', () => {
    expect(visibleSections(on, false, null, true)).toEqual(['home', 'funds', 'community', 'market', 'screener'])
    expect(visibleSections(null, null)).toEqual(['home', 'funds', 'community', 'market'])
  })
  it('내정보는 탭에 없다(헤더 우측 버튼으로 이동)', () => {
    expect(visibleSections(on, true, null, true)).not.toContain('me')
    expect(visibleSections(null, null)).not.toContain('me')
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

describe('게임 탭 — 관리자 REAL_MARKET 스위치로 실시간/가상 데이터 게임 중 하나', () => {
  it('스위치 OFF 면 가상 데이터 게임 공개일 때 노출(관리자 real_market=true 여도 같은 규칙)', () => {
    expect(visibleSections(null, false, true, false)).toContain('game')
    expect(visibleSections(null, true, true, false)).toContain('game')
    expect(visibleSections(null, true, false, false)).not.toContain('game')
    expect(visibleSections(null, false, false, false)).not.toContain('game')
  })
  it('스위치 ON 이면 실시간 허용일 때만 노출, 가상 데이터 게임 공개 여부와 무관', () => {
    expect(visibleSections(null, true, false, true)).toContain('game')
    expect(visibleSections(null, false, true, true)).not.toContain('game')
  })
  it('스위치 모름(null)·안 넘김이면 숨김', () => {
    expect(visibleSections(null, true, true, null)).not.toContain('game')
    expect(visibleSections(null, true, true)).not.toContain('game')
    expect(visibleSections(null, false)).not.toContain('game')
  })
  it('/edu-game 은 게임 섹션', () => {
    expect(sectionOf('/edu-game')).toBe('game')
  })
})

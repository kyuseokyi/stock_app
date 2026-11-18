import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FUND_LOGIN_DESCRIPTION, FUNDS_PATH, fundNavAction, isLoginGatedSection } from './fundGate'
import { rememberLoginReturn, takeLoginReturn } from './socialLogin'
import { openLogin, useLoginPromptStore } from '../store/loginPrompt'

describe('내 펀드 로그인 게이트', () => {
  it('로그인했으면 이동, 비로그인이면 로그인 모달', () => {
    expect(fundNavAction(true)).toBe('navigate')
    expect(fundNavAction(false)).toBe('login')
  })
  it('게이트는 내 펀드 탭에만 걸린다', () => {
    expect(isLoginGatedSection('funds')).toBe(true)
    for (const s of ['home', 'community', 'game', 'market', 'screener', 'me']) {
      expect(isLoginGatedSection(s)).toBe(false)
    }
  })
  it('안내 문구와 이동 경로', () => {
    expect(FUND_LOGIN_DESCRIPTION).toBe('내 펀드 수익률을 확인하려면 로그인이 필요해요')
    expect(FUNDS_PATH).toBe('/me/funds')
  })
})

describe('로그인 모달 스토어', () => {
  afterEach(() => useLoginPromptStore.getState().close())

  it('내 펀드에서 열면 안내 문구·복귀 경로를 함께 담는다', () => {
    openLogin({ description: FUND_LOGIN_DESCRIPTION, returnTo: FUNDS_PATH })
    const s = useLoginPromptStore.getState()
    expect(s.open).toBe(true)
    expect(s.description).toBe(FUND_LOGIN_DESCRIPTION)
    expect(s.returnTo).toBe(FUNDS_PATH)
  })
  it('헤더에서 다시 열면 이전 복귀 경로가 남지 않는다', () => {
    openLogin({ description: FUND_LOGIN_DESCRIPTION, returnTo: FUNDS_PATH })
    useLoginPromptStore.getState().close()
    openLogin()
    const s = useLoginPromptStore.getState()
    expect(s.open).toBe(true)
    expect(s.description).toBeUndefined()
    expect(s.returnTo).toBeUndefined()
  })
})

describe('간편 로그인 복귀 경로(rememberLoginReturn)', () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    })
    vi.stubGlobal('window', { location: { pathname: '/community', search: '?a=1' } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('경로를 주지 않으면 현재 경로로 돌아온다(기존 동작)', () => {
    rememberLoginReturn()
    expect(takeLoginReturn()).toBe('/community?a=1')
  })
  it('내 펀드에서 시작한 로그인은 /me/funds 로 돌아온다', () => {
    rememberLoginReturn(FUNDS_PATH)
    expect(takeLoginReturn()).toBe('/me/funds')
  })
  it('바깥 주소는 무시하고 현재 경로로', () => {
    rememberLoginReturn('//evil.example')
    expect(takeLoginReturn()).toBe('/community?a=1')
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { currentFundOwner, fundListKey, loadFunds, saveFunds } from './fundStore'

// 앱 fund-store.test.ts 이식. 앱은 SecureStore(비동기)·hydrate 전 오류·소유자 목록(fund_owners_v1, iOS 재설치 정리)·
// saveFundsAs/renameFundAs 가 있고, 웹은 localStorage(동기)에 saveFunds(list, uid) 가 "읽은 계정 = 지금 계정"일 때만 쓰고
// 아니면 false 를 돌려준다. 웹에 없는 소유자 목록·이름 변경·hydrate 테스트는 제외.

const mockAuth = vi.hoisted(() => ({ user: null as { id: number } | null }))
vi.mock('../store/auth', () => ({ useAuthStore: { getState: () => mockAuth } }))

const URL_A = 'https://fund.ivyro.net/dataroom/om_data/a.htm'
const URL_B = 'https://fund.ivyro.net/dataroom/om_data/b.htm'
const fa = { id: 'a1', name: 'A', url: URL_A }
const fb = { id: 'b1', name: 'B', url: URL_B }

const mem = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}

beforeEach(() => {
  mem.clear()
  vi.stubGlobal('localStorage', fakeStorage)
  mockAuth.user = { id: 7 }
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('현재 소유자', () => {
  it('로그인이면 user.id', () => {
    expect(currentFundOwner()).toBe(7)
  })
  it('로그인 안 됨이면 null(앱은 오류를 던진다)', () => {
    mockAuth.user = null
    expect(currentFundOwner()).toBeNull()
  })
})

describe('계정별 펀드 목록', () => {
  it('fund_list_v1_u<id> 키에 저장하고 읽는다(옛 키는 건드리지 않음)', () => {
    mem.set('fund_list_v1', JSON.stringify([fb]))
    expect(saveFunds([fa], 7)).toBe(true)
    expect(fundListKey(7)).toBe('fund_list_v1_u7')
    expect(JSON.parse(mem.get('fund_list_v1_u7')!)).toEqual([fa])
    expect(loadFunds()).toEqual([fa])
    expect(JSON.parse(mem.get('fund_list_v1')!)).toEqual([fb])
  })

  it('계정 A/B 전환 시 목록이 분리된다', () => {
    saveFunds([fa], 7)
    mockAuth.user = { id: 8 }
    expect(loadFunds()).toEqual([])
    saveFunds([fb], 8)
    mockAuth.user = { id: 7 }
    expect(loadFunds()).toEqual([fa])
  })

  it('로그인 안 됨이면 빈 목록·저장 안 함, 아무 키도 쓰지 않는다', () => {
    mockAuth.user = null
    expect(loadFunds()).toEqual([])
    expect(saveFunds([fa], null)).toBe(false)
    expect(mem.size).toBe(0)
  })

  it('localStorage 를 못 쓰면 빈 목록·저장 실패(false)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadFunds()).toEqual([])
    expect(saveFunds([fa], 7)).toBe(false)
  })
})

describe('목록을 읽은 계정(uid)으로만 저장 — 계정 전환 중 다른 계정 키로 새지 않게', () => {
  it('지금 소유자가 uid 면 그 계정 키에 저장', () => {
    expect(saveFunds([fa], 7)).toBe(true)
    expect(loadFunds(7)).toEqual([fa])
  })

  it('지금 소유자가 바뀌었으면(A→B) 저장하지 않는다 — A 목록 기반 next 가 B 키에 쓰이지 않게', () => {
    mockAuth.user = { id: 8 }
    saveFunds([fb], 8)
    expect(saveFunds([fa], 7)).toBe(false)
    expect(mem.has('fund_list_v1_u7')).toBe(false)
    expect(loadFunds(8)).toEqual([fb])
  })

  it('로그아웃(소유자 없음)이어도 저장하지 않는다', () => {
    mockAuth.user = null
    expect(saveFunds([fa], 7)).toBe(false)
    expect(mem.size).toBe(0)
  })
})

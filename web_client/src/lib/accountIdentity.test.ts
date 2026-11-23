import { describe, expect, it } from 'vitest'
import { accountIdentityLabel } from './accountIdentity'

const base = { id: 12, email: null, role: 'FREE' as const }

describe('accountIdentityLabel', () => {
  it('소셜 로그인 방식별 라벨', () => {
    expect(accountIdentityLabel({ ...base, provider: 'KAKAO' })).toBe('회원 번호 #12 · 카카오 로그인')
    expect(accountIdentityLabel({ ...base, provider: 'NAVER' })).toBe('회원 번호 #12 · 네이버 로그인')
    expect(accountIdentityLabel({ ...base, provider: 'GOOGLE' })).toBe('회원 번호 #12 · 구글 로그인')
    expect(accountIdentityLabel({ ...base, provider: 'APPLE' })).toBe('회원 번호 #12 · 애플 로그인')
    expect(accountIdentityLabel({ ...base, provider: 'LINE' })).toBe('회원 번호 #12 · LINE 로그인')
  })

  it('관리자 — 공급자 없으면 이메일 로그인 + 이메일', () => {
    expect(accountIdentityLabel({ id: 1, email: 'admin@stock.app', role: 'ADMIN', provider: null })).toBe(
      '회원 번호 #1 · 이메일 로그인 · 관리자 · admin@stock.app',
    )
    expect(accountIdentityLabel({ ...base, role: 'ADMIN', provider: 'NAVER' })).toBe('회원 번호 #12 · 네이버 로그인 · 관리자')
  })

  it('공급자 없는 일반 계정은 방식 생략, 옛 저장값(필드 없음)도 생략', () => {
    expect(accountIdentityLabel({ ...base, email: 'g@guest.local', provider: null })).toBe('회원 번호 #12 · g@guest.local')
    expect(accountIdentityLabel(base)).toBe('회원 번호 #12')
  })
})

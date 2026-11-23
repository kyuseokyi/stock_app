import type { UserOut } from '../types/api'

/** 로그인 방식 코드(서버 AuthProvider) → 화면 라벨 */
const PROVIDER_LABELS: Record<string, string> = {
  KAKAO: '카카오',
  NAVER: '네이버',
  GOOGLE: '구글',
  APPLE: '애플',
}

type IdentityUser = Pick<UserOut, 'id' | 'email' | 'role' | 'provider'>

/**
 * 내정보 계정 식별 한 줄 — 관리자 회원관리 화면의 어느 행인지 맞춰 보기 위함(앱 accountIdentityLabel 과 같은 규칙).
 * 예) `회원 번호 #12 · 카카오 로그인 · 관리자 · a@b.com`
 * - provider 문자열 → `<라벨> 로그인`(모르는 코드는 원문)
 * - provider null + ADMIN → `이메일 로그인`. null + 일반(게스트·심사)은 생략
 * - provider 없음(옛 저장값·구 서버) → 생략
 * - 관리자면 `관리자`, 이메일이 있으면 맨 끝에 덧붙인다
 */
export function accountIdentityLabel(user: IdentityUser): string {
  const isAdmin = user.role === 'ADMIN'
  const parts = [`회원 번호 #${user.id}`]
  if (typeof user.provider === 'string' && user.provider !== '') {
    parts.push(`${PROVIDER_LABELS[user.provider.toUpperCase()] ?? user.provider} 로그인`)
  } else if (user.provider === null && isAdmin) {
    parts.push('이메일 로그인')
  }
  if (isAdmin) parts.push('관리자')
  if (user.email) parts.push(user.email)
  return parts.join(' · ')
}

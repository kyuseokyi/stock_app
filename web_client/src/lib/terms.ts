import axios from 'axios'

// 이용약관 동의 모달의 순수 판정·문구(2026-11-13 설계) — 앱 mobile/src/features/auth/terms.ts 와 같은 문구

/** 현재 약관 버전 — 서버 backend/apps/auth/terms.py 의 TERMS_VERSION 과 반드시 같아야 한다(다르면 동의가 409) */
export const TERMS_VERSION = '2026-11-13'

/** 약관 동의 모달의 요약 3줄 */
export const TERMS_SUMMARY = [
  'FunNote의 정보는 참고용이며 투자 권유가 아니에요',
  '모의투자는 가상 자금으로만 진행돼요',
  '욕설·스팸·사기 권유는 금지되며, 신고되면 조치해요',
] as const

/** 내정보 정책 링크 위 정보 제공 고지 */
export const INFO_NOTICE =
  'FunNote는 투자 정보를 참고용으로 제공하며 투자 권유·자문을 하지 않습니다. 모의투자는 가상 자금으로 진행돼요.'

export const TERMS_DECLINED_MESSAGE = '약관에 동의해야 회원 기능을 쓸 수 있어요'

/** 모달을 띄우지 않는 경로 — 모달의 약관·방침 링크로 이동해 읽을 수 있게 */
const READABLE_PATHS = ['/terms', '/privacy']

/**
 * 약관 동의 모달 표시 조건: 로그인(토큰+사용자) + 서버가 terms_required=true + 약관·방침 화면이 아님.
 * terms_required 가 없는 옛 저장값·구 서버는 띄우지 않는다(서버 판정만 믿는다).
 */
export function shouldShowTermsModal(
  token: string | null,
  user: { terms_required?: boolean } | null,
  pathname: string,
): boolean {
  if (!token || user?.terms_required !== true) return false
  const path = pathname.replace(/\/+$/, '') || '/'
  return !READABLE_PATHS.includes(path)
}

/** 동의 실패 → 모달 안 문구 */
export function agreeTermsErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response) return '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
  if (err.response.status === 409) return '약관이 바뀌었어요. 페이지를 새로고침해 주세요.'
  if (err.response.status === 401) return '로그인이 만료되었어요. 다시 로그인해 주세요.'
  return '동의를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
}

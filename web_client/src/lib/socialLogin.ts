// 간편 로그인 보조 — 복귀 경로 보관(sessionStorage)과 오류 코드 문구.
// 복귀 경로는 같은 사이트 내부 경로만 허용한다(오픈 리다이렉트 방지).

const RETURN_KEY = 'wc_login_return'
export const AUTH_COMPLETE_PATH = '/auth/complete'

/** 내부 경로만 허용: '/'로 시작, '//'·'/\' 금지, 완료 라우트 자신 금지 */
export function isSafeReturnPath(path: string | null): path is string {
  return (
    !!path &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    !path.startsWith(AUTH_COMPLETE_PATH)
  )
}

/** 공급자로 떠나기 직전 현재 경로를 기억 */
export function rememberLoginReturn(): void {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search)
  } catch {
    // 저장 불가(사파리 프라이빗 등) → 완료 후 홈으로
  }
}

/** 기억한 경로를 꺼내고 지운다. 없거나 안전하지 않으면 '/' */
export function takeLoginReturn(): string {
  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    saved = null
  }
  return isSafeReturnPath(saved) ? saved : '/'
}

/** 콜백 ?error= 코드 → 사용자 문구 (출처: backend/apps/auth/routers/social.py) */
export function socialErrorMessage(code: string): string {
  switch (code) {
    case 'cancelled':
      return '로그인을 취소했어요.'
    case 'inactive':
      return '이용이 제한된 계정이에요. 고객센터로 문의해 주세요.'
    case 'state_invalid':
      return '로그인 요청이 만료되었어요. 다시 시도해 주세요.'
    case 'provider_failed':
    default:
      return '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.'
  }
}

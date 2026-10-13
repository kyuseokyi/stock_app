// 간편 로그인 보조 — 복귀 경로 보관(sessionStorage)과 오류 코드 문구.
// 복귀 경로는 같은 사이트 내부 경로만 허용한다(오픈 리다이렉트 방지).

const RETURN_KEY = 'wc_login_return'
const VERIFIER_KEY = 'wc_social_verifier'
export const AUTH_COMPLETE_PATH = '/auth/complete'

// ---- PKCE 방식 verifier ----
// 시작 전에 무작위 verifier 를 만들어 sessionStorage 에 두고 challenge(cc)만 서버로 보낸다.
// 완료 라우트는 verifier 를 꺼내 교환 요청에 실어 보낸다 — 교환 코드를 가로채거나
// 남의 브라우저에 심어도(verifier 없음) 토큰을 받을 수 없다.

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32바이트 무작위 verifier(base64url, 43자) */
export function createVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/** cc = base64url(sha256(verifier)) — crypto.subtle 은 보안 컨텍스트(https·localhost)에서만 동작 */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/**
 * 공급자로 떠나기 직전 verifier 를 만들어 보관하고 cc 를 돌려준다.
 * 보관에 실패하면 완료 후 교환이 불가능하므로 예외를 던진다(이동하지 않음).
 */
export async function prepareSocialVerifier(): Promise<string> {
  const verifier = createVerifier()
  const cc = await challengeFor(verifier)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  return cc
}

/** 보관한 verifier 를 꺼내고 지운다(1회). 없으면 null */
export function takeSocialVerifier(): string | null {
  try {
    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    sessionStorage.removeItem(VERIFIER_KEY)
    return verifier
  } catch {
    return null
  }
}

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

/**
 * 간편 로그인 복귀 URL 파싱(순수 함수 — Expo/RN 의존 없음, jest 대상).
 * auth 콜백은 `stockapp[-dev]://auth?code=…` 또는 `…?error=…` 로 돌려보낸다.
 * RN 의 URL/URLSearchParams 구현은 불완전할 수 있어 직접 파싱한다.
 */

export type AuthReturn = { type: 'code'; code: string } | { type: 'error'; error: string };

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

function parseQuery(url: string): Map<string, string> {
  const params = new Map<string, string>();
  const start = url.indexOf('?');
  if (start < 0) return params;
  const hash = url.indexOf('#', start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = safeDecode(eq < 0 ? pair : pair.slice(0, eq));
    const value = safeDecode(eq < 0 ? '' : pair.slice(eq + 1));
    if (key && value !== null && !params.has(key)) params.set(key, value);
  }
  return params;
}

/** 복귀 URL → code 또는 error. 둘 다 없으면 null. error 가 우선한다. */
export function parseAuthReturnUrl(url: string): AuthReturn | null {
  const params = parseQuery(url);
  const error = params.get('error');
  if (error) return { type: 'error', error };
  const code = params.get('code');
  if (code) return { type: 'code', code };
  return null;
}

/** 간편 로그인 복귀 딥링크인지(`<scheme>://auth?...`, `/auth?...`) — expo-router 라우팅 제외용 */
export function isAuthReturnUrl(url: string): boolean {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^\/+/, '');
  return /^auth(?:[/?#]|$)/.test(rest);
}

/** 콜백 ?error= 코드 → 사용자 문구 (출처: backend/apps/auth/routers/social.py) */
export function socialErrorMessage(code: string): string {
  switch (code) {
    case 'cancelled':
      return '로그인을 취소했어요.';
    case 'inactive':
      return '이용이 제한된 계정이에요. 고객센터로 문의해 주세요.';
    case 'state_invalid':
      return '로그인 요청이 만료되었어요. 다시 시도해 주세요.';
    default:
      return '로그인에 실패했어요. 잠시 후 다시 시도해 주세요.';
  }
}

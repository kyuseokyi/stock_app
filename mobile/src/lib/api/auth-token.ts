/**
 * 인증 토큰 메모리 홀더.
 * SecureStore는 비동기라 요청 시점에 동기적으로 읽을 수 없으므로, 현재 토큰을 메모리에 캐시한다.
 * http 클라이언트 <-> auth store 간 순환 참조를 피하기 위해 이 파일은 둘 중 어느 쪽도 import하지 않는다.
 */

import type { SessionEndReason } from './session-end';

let token: string | null = null;
let onUnauthorized: ((rejectedToken: string | null, reason: SessionEndReason) => void) | null = null;

export function getAuthToken(): string | null {
  return token;
}

export function setAuthToken(next: string | null): void {
  token = next;
}

/** 401 응답을 받았을 때 실행할 콜백을 등록한다(auth store 의 expireSession). */
export function registerUnauthorizedHandler(
  handler: ((rejectedToken: string | null, reason: SessionEndReason) => void) | null,
): void {
  onUnauthorized = handler;
}

/** rejectedToken = 401 받은 요청에 실었던 토큰(재로그인 직후 이전 요청의 401 이 새 세션을 지우지 않게) */
export function notifyUnauthorized(rejectedToken: string | null, reason: SessionEndReason): void {
  onUnauthorized?.(rejectedToken, reason);
}

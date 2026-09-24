/**
 * 인증 토큰 메모리 홀더.
 * SecureStore는 비동기라 요청 시점에 동기적으로 읽을 수 없으므로, 현재 토큰을 메모리에 캐시한다.
 * http 클라이언트 <-> auth store 간 순환 참조를 피하기 위해 이 파일은 둘 중 어느 쪽도 import하지 않는다.
 */

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function getAuthToken(): string | null {
  return token;
}

export function setAuthToken(next: string | null): void {
  token = next;
}

/** 401 응답을 받았을 때 실행할 콜백을 등록한다(보통 auth store의 logout). */
export function registerUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

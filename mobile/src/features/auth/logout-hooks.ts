// 로그아웃 "직전" 훅 — 토큰이 지워지기 전에 받아 서버 정리(푸시 해제 등). 순환 참조를 피해 store 와 분리
// 훅이 Promise 를 돌려주면 runBeforeLogout 이 (시간 상한 안에서) 끝나기를 기다린다 — 그 뒤에 서버 로그아웃(/auth/logout)이
// 세션을 지워야 푸시 해제 요청이 401 로 실패하지 않는다.
type Hook = (authToken: string) => void | Promise<unknown>;
const hooks = new Set<Hook>();

/** 훅을 기다리는 최대 시간 — 멈춘 네트워크가 서버 로그아웃을 무한정 미루지 않게 */
export const BEFORE_LOGOUT_TIMEOUT_MS = 10_000;

export function registerBeforeLogout(hook: Hook): () => void {
  hooks.add(hook);
  return () => hooks.delete(hook);
}

/** 모든 훅을 실행(동기 부분은 즉시)하고, 비동기 훅이 끝나거나 timeoutMs 가 지나면 resolve. 실패는 무시 */
export function runBeforeLogout(authToken: string, timeoutMs = BEFORE_LOGOUT_TIMEOUT_MS): Promise<void> {
  const pending: Promise<unknown>[] = [];
  hooks.forEach((h) => {
    try {
      const r = h(authToken);
      if (r && typeof (r as Promise<unknown>).then === 'function') pending.push(r);
    } catch {
      // 훅 실패가 로그아웃을 막지 않는다
    }
  });
  if (pending.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void Promise.allSettled(pending).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

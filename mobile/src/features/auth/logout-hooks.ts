// 로그아웃 "직전" 훅 — 토큰이 지워지기 전에 받아 서버 정리(푸시 해제 등). 순환 참조를 피해 store 와 분리
type Hook = (authToken: string) => void;
const hooks = new Set<Hook>();

export function registerBeforeLogout(hook: Hook): () => void {
  hooks.add(hook);
  return () => hooks.delete(hook);
}

export function runBeforeLogout(authToken: string): void {
  hooks.forEach((h) => {
    try {
      h(authToken);
    } catch {
      // 훅 실패가 로그아웃을 막지 않는다
    }
  });
}

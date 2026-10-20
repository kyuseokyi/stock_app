/** 시장 칩 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000;

/**
 * 조용한 새로고침 실행기 — 스피너·토스트 없이 run 을 부른다.
 * - 앞 실행이 끝나기 전 호출은 건너뜀(느린 네트워크에서 요청이 쌓이지 않게)
 * - 실패(동기 예외 포함)는 삼킨다 — 다음 주기에 다시 시도
 */
export function createSilentRunner(run: () => Promise<unknown>): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(run)
      .catch(() => undefined)
      .finally(() => {
        busy = false;
      });
  };
}

/**
 * 포커스·앱 복귀 때 즉시 갱신할지 — 마지막 실행 후 주기 이상 지났을 때만(탭을 빠르게 오갈 때 중복 방지).
 * 한 번도 안 돌았거나 시계가 거꾸로 갔으면 즉시.
 */
export function shouldRefreshNow(lastAt: number | null, now: number, ms = MARKET_REFRESH_MS): boolean {
  return lastAt == null || now < lastAt || now - lastAt >= ms;
}

/** 시장 칩 자동 새로고침 주기 — 서버 장중 수집 주기(30초)와 같다 */
export const MARKET_REFRESH_MS = 30_000;

/** 복귀 재조회 기준 — 하루 몇 번만 바뀌는 데이터(히트맵·테마·업종·수급·브리핑·일정)는 마지막 조회 후 이만큼 지나야 다시 받는다 */
export const RETURN_REFRESH_MS = 600_000;

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

/**
 * 화면·앱 복귀 때 다시 조회할지 — 마지막 조회 후 ms 이상 지났을 때만.
 * 아직 조회한 적이 없으면(첫 진입, 첫 로딩이 진행 중) 중복을 막으려 false. 시계가 거꾸로 갔으면 true.
 */
export function shouldRefetchOnReturn(lastFetchedAt: number | null, now: number, ms = RETURN_REFRESH_MS): boolean {
  if (lastFetchedAt == null) return false;
  return now < lastFetchedAt || now - lastFetchedAt >= ms;
}

/** fn 을 실행하고, 성공·실패와 무관하게 끝난 시각을 clock 에 남긴다(복귀 재조회 판정용) */
export async function stampFetch<T>(clock: { current: number | null }, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  try {
    return await fn();
  } finally {
    clock.current = now();
  }
}

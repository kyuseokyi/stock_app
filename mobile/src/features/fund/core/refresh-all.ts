// 등록한 펀드 전체 다시 가져오기 — 앱 실행·복귀, 웹 접속 때(자동 갱신). 플랫폼 무관.
// web_client/src/lib/fundCore 에 같은 파일이 있다 — scripts/check-fund-core-sync.sh
import type { FundEntry } from './funds';
import { readValidCache, refreshReport, type CacheEntry, type RefreshDeps } from './refresh';
import { isFundError, type FundErrorCode } from './types';

/** 마지막 확인이 이보다 최근이면 건너뜀 — 앱을 자주 오가도 원본 서버를 반복해서 두드리지 않도록 */
export const AUTO_REFRESH_MIN_AGE_MS = 10 * 60_000;

export type RefreshOutcome = { entry: CacheEntry } | { error: FundErrorCode };

export type RefreshAllDeps = RefreshDeps & {
  minAgeMs?: number;
  concurrency?: number; // 기본 2
  force?: boolean; // true 면 minAgeMs 무시
  onResult?: (fund: FundEntry, r: RefreshOutcome) => void;
};

export type RefreshAllResult = { refreshed: number; skipped: number; failed: number };

export async function refreshAll(funds: FundEntry[], deps: RefreshAllDeps): Promise<RefreshAllResult> {
  const minAge = deps.minAgeMs ?? AUTO_REFRESH_MIN_AGE_MS;
  const result: RefreshAllResult = { refreshed: 0, skipped: 0, failed: 0 };
  const report = (fund: FundEntry, r: RefreshOutcome) => {
    try {
      deps.onResult?.(fund, r);
    } catch {
      // 알림 받는 쪽 오류는 갱신에 영향 없음
    }
  };

  const one = async (fund: FundEntry) => {
    if (!deps.force) {
      const c = await readValidCache(deps.cache, fund.id).catch(() => null);
      if (c && c.fetchedAt >= deps.now() - minAge) {
        result.skipped++;
        return;
      }
    }
    try {
      const { entry } = await refreshReport(fund, deps);
      result.refreshed++;
      report(fund, { entry });
    } catch (e) {
      result.failed++;
      report(fund, { error: isFundError(e) ? e.fundCode : 'fetch' });
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < funds.length) await one(funds[next++]);
  };
  const n = Math.min(Math.max(1, deps.concurrency ?? 2), funds.length);
  await Promise.all(Array.from({ length: n }, worker));
  return result;
}

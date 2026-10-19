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

export type AutoRefreshStatus = { running: boolean; version: number; refreshedIds: readonly string[] };

export type AutoRefresher = {
  /** 진행 중이면 같은 Promise. 진행 중 force 요청은 끝난 뒤 force 로 한 번 더(신호 유실 방지). */
  run(opts?: { force?: boolean }): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** 바뀌기 전까지 같은 객체 — useSyncExternalStore 의 getSnapshot 으로 쓴다 */
  getStatus(): AutoRefreshStatus;
};

export function createAutoRefresher(cfg: {
  loadFunds: () => Promise<FundEntry[]>;
  deps: Omit<RefreshAllDeps, 'force' | 'onResult'>;
  /** 새로 가져온 펀드마다(앱: 히스토리 기록). 오류는 무시 */
  onRefreshed?: (fund: FundEntry, entry: CacheEntry) => unknown;
}): AutoRefresher {
  let status: AutoRefreshStatus = { running: false, version: 0, refreshedIds: [] };
  const listeners = new Set<() => void>();
  let current: Promise<void> | null = null;
  let pendingForce = false;

  const setStatus = (s: AutoRefreshStatus) => {
    status = s;
    listeners.forEach((l) => l());
  };

  const once = async (force: boolean) => {
    const ids: string[] = [];
    setStatus({ ...status, running: true });
    try {
      const funds = await cfg.loadFunds();
      await refreshAll(funds, {
        ...cfg.deps,
        force,
        onResult: (fund, r) => {
          if (!('entry' in r)) return;
          ids.push(fund.id);
          void Promise.resolve()
            .then(() => cfg.onRefreshed?.(fund, r.entry))
            .catch(() => {});
        },
      });
    } catch {
      // 목록 읽기 실패 — 다음 실행 때 다시
    } finally {
      setStatus({ running: false, version: status.version + 1, refreshedIds: ids });
    }
  };

  return {
    run({ force = false } = {}) {
      if (current) {
        if (force) pendingForce = true;
        return current;
      }
      current = (async () => {
        let f = force;
        do {
          pendingForce = false;
          await once(f);
          f = true;
        } while (pendingForce);
      })().finally(() => {
        current = null;
      });
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStatus: () => status,
  };
}

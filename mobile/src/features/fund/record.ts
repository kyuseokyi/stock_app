// 새로 가져온 리포트를 히스토리에 기록 — 리포트 화면·자동 갱신 공용. 같은 (펀드, fetchedAt) 은 한 번만.
// 새 날짜가 생기면 자동 백업(하루 1번 규칙은 maybeAutoBackup 이 판단).
import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { recordSnapshot } from './history-store';

const recorded = new Map<string, number>(); // 펀드 id → 마지막으로 기록한 fetchedAt

/** 기록했으면 true(새 날짜가 생김). backup:false 면 자동 백업은 호출자가 맡는다. 백업은 기다리지 않는다. */
export async function recordFetched(
  fund: FundEntry,
  entry: CacheEntry,
  opts: { backup?: boolean } = {},
): Promise<boolean> {
  if (recorded.get(fund.id) === entry.fetchedAt) return false;
  recorded.set(fund.id, entry.fetchedAt);
  const added = await recordSnapshot(fund, entry.report, entry.fetchedAt);
  if (opts.backup !== false && added) void maybeAutoBackup();
  return added;
}

export const resetRecordedForTest = (): void => recorded.clear();

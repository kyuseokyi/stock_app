// 새로 가져온 리포트를 히스토리에 기록 — 리포트 화면·자동 갱신 공용. 같은 (펀드, fetchedAt) 은 한 번만.
// 새 날짜가 생기면 자동 백업(하루 1번 규칙은 maybeAutoBackup 이 판단).
import { maybeAutoBackup } from './backup-service';
import type { CacheEntry, FundEntry } from './core';
import { recordSnapshot } from './history-store';

const recorded = new Map<string, number>(); // 펀드 id → 마지막으로 기록한 fetchedAt

export async function recordFetched(fund: FundEntry, entry: CacheEntry): Promise<void> {
  if (recorded.get(fund.id) === entry.fetchedAt) return;
  recorded.set(fund.id, entry.fetchedAt);
  const added = await recordSnapshot(fund, entry.report, entry.fetchedAt);
  if (added) await maybeAutoBackup();
}

export const resetRecordedForTest = (): void => recorded.clear();

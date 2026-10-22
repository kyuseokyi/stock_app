// 계정별 저장 전(기기 공용 키 fund_list_v1)에 쌓인 펀드 — 처음 들어온 계정이 가져오거나 버린다(2026-10-23 설계).
// 순서: 내 키를 먼저 쓰고 옛 키를 마지막에 지운다 — 도중에 꺼져도 다음 진입 때 다시 물어 같은 결과(멱등)가 된다.
import * as SecureStore from 'expo-secure-store';

import { LEGACY_PENDING_FILE, markBackupPending, removeFile } from './background/backup-pending';
import { backupStateKey, LEGACY_BACKUP_STATE_KEY, parseBackupState } from './backup-state';
import { mergeAccounts, mergeFundLists, parseFundList, type FundEntry } from './core';
import { deleteCache, loadFunds, saveFunds } from './fund-store';
import { deleteHistory, loadAllHistories, writeHistories } from './history-store';
import { currentOwnerId, LEGACY_FUND_LIST_KEY } from './owner';

/** 옛 키의 펀드(없거나 깨졌으면 빈 목록). 읽기 실패는 던진다. */
export async function loadLegacyFunds(): Promise<FundEntry[]> {
  return parseFundList(await SecureStore.getItemAsync(LEGACY_FUND_LIST_KEY));
}

/** 내 목록이 쓰지 않는 id 의 캐시·기록 파일만 지운다 */
function deleteFilesExcept(funds: FundEntry[], keepIds: Set<string>): void {
  for (const f of funds) {
    if (keepIds.has(f.id)) continue;
    deleteCache(f.id);
    deleteHistory(f.id);
  }
}

/** URL 이 같은 옛 펀드의 기록을 내 펀드 기록에 합친다. 성공하면 true(그때만 옛 파일을 지운다). */
async function mergeHistoryInto(legacy: FundEntry, mine: FundEntry): Promise<boolean> {
  try {
    const [from, into] = [await loadAllHistories([legacy]), await loadAllHistories([mine])];
    const merged = mergeAccounts(into[mine.url] ?? {}, from[legacy.url] ?? {}).accounts;
    writeHistories([mine], { [mine.url]: merged });
    return true;
  } catch {
    return false; // 못 합쳐도 가져오기는 계속 — 옛 파일은 남겨 둔다
  }
}

const isEmptyState = (raw: string | null): boolean => {
  if (!raw) return true;
  const s = parseBackupState(raw);
  return !s.connected && !s.email && s.lastBackupAt === null;
};

export type LegacyImportResult = { added: number; skipped: number };

/** 가져오기 — 합치기(URL 중복 제거·한도) → 내 키 저장 → 백업 상태·대기 표시 넘김 → 옛 키 삭제 */
export async function importLegacyFunds(): Promise<LegacyImportResult> {
  const uid = currentOwnerId();
  const legacy = await loadLegacyFunds();
  const r = mergeFundLists(await loadFunds(uid), legacy);

  const mergedDup: FundEntry[] = [];
  for (const d of r.duplicates) if (await mergeHistoryInto(d.legacy, d.mine)) mergedDup.push(d.legacy);
  await saveFunds(r.funds, uid);

  // 옛 백업 상태는 내 상태가 비었을 때만 넘긴다(이미 연결한 계정의 상태를 덮지 않게)
  const legacyState = await SecureStore.getItemAsync(LEGACY_BACKUP_STATE_KEY);
  if (legacyState && isEmptyState(await SecureStore.getItemAsync(backupStateKey(uid)))) {
    await SecureStore.setItemAsync(backupStateKey(uid), legacyState);
  }
  if (removeFile(LEGACY_PENDING_FILE)) markBackupPending(uid);

  deleteFilesExcept([...mergedDup, ...r.dropped], new Set(r.funds.map((f) => f.id)));
  await SecureStore.deleteItemAsync(LEGACY_BACKUP_STATE_KEY);
  await SecureStore.deleteItemAsync(LEGACY_FUND_LIST_KEY);
  return { added: r.added, skipped: r.skipped };
}

/** 버리기 — 옛 펀드의 캐시·기록 파일, 옛 백업 상태·대기 표시, 옛 키 삭제. 내 목록이 쓰는 id 는 남긴다. */
export async function discardLegacyFunds(): Promise<void> {
  const uid = currentOwnerId();
  const legacy = await loadLegacyFunds();
  const mine = await loadFunds(uid); // 못 읽으면 던진다 — 내 펀드 파일을 지울 위험을 피한다
  deleteFilesExcept(legacy, new Set(mine.map((f) => f.id)));
  removeFile(LEGACY_PENDING_FILE);
  await SecureStore.deleteItemAsync(LEGACY_BACKUP_STATE_KEY);
  await SecureStore.deleteItemAsync(LEGACY_FUND_LIST_KEY);
}

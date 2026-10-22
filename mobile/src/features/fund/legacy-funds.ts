// 계정별 저장 전(기기 공용 키 fund_list_v1)에 쌓인 펀드 — 처음 들어온 계정이 가져오거나 버린다(2026-10-23 설계).
// 순서: 내 키를 먼저 쓰고 옛 키를 마지막에 지운다 — 도중에 꺼져도 다음 진입 때 다시 물어 같은 결과(멱등)가 된다.
// 등록 한도로 못 가져온 펀드(dropped)는 옛 키에 남기고 파일도 보존 — 다른 계정이 가져가거나 버릴 수 있게.
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

export type LegacyImportPreview = {
  /** 옛 키의 펀드 수 */
  count: number;
  /** 이 계정이 가져갈 수 있는 수(새로 추가 + URL 이 겹쳐 기록만 합쳐지는 것 포함) */
  importable: number;
  /** 등록 한도로 이 계정이 가져갈 수 없는 수 — 옛 키에 남는다 */
  dropped: number;
  /** 시트를 띄울지 — 이 계정이 하나도 가져갈 수 없으면(목록이 꽉 참) 띄우지 않는다. 자리가 나면 다시 뜬다 */
  show: boolean;
};

/** 가져오기 미리보기 — 시트 표시 여부와 "N개만 가져올 수 있어요" 안내용 */
export function previewLegacyImport(mine: FundEntry[], legacy: FundEntry[]): LegacyImportPreview {
  const dropped = mergeFundLists(mine, legacy).dropped.length;
  const importable = legacy.length - dropped;
  return { count: legacy.length, importable, dropped, show: importable > 0 };
}

/** 가져오기 — 합치기(URL 중복 제거·한도) → 내 키 저장 → 백업 상태·대기 표시 넘김 → 옛 키 삭제(한도로 남은 펀드만 다시 기록) */
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

  // 합쳐진 중복 펀드의 옛 파일만 지운다. 한도로 남은 펀드(dropped)의 캐시·기록은 그대로 둔다
  deleteFilesExcept(mergedDup, new Set(r.funds.map((f) => f.id)));
  await SecureStore.deleteItemAsync(LEGACY_BACKUP_STATE_KEY); // 백업 상태·대기 표시는 처음 가져간 계정이 맡는다
  if (r.dropped.length > 0) await SecureStore.setItemAsync(LEGACY_FUND_LIST_KEY, JSON.stringify(r.dropped));
  else await SecureStore.deleteItemAsync(LEGACY_FUND_LIST_KEY);
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

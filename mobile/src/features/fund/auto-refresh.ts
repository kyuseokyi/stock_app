// 앱 실행·복귀 때 등록한 펀드를 모두 다시 가져온다(10분 이내 확인한 펀드는 건너뜀). 성공한 펀드는 히스토리에 기록.
// 로직(건너뛰기·동시 2개·single-flight)은 core createAutoRefresher — 여기선 앱 저장소·실행 시점만 연결.
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuthStore } from '@/features/auth/store';

import { isBackgroundRun } from './background/background-mode';
import { markBackupPending, takeBackupPending } from './background/backup-pending';
import { maybeAutoBackup } from './backup-service';
import { createAutoRefresher, fetchReportHtml, type CacheEntry, type FundEntry } from './core';
import { deleteCache, fileCache, loadFunds } from './fund-store';
import { currentOwnerId, currentOwnerIdOrNull } from './owner';
import { recordFetched } from './record';

/**
 * 갱신 중 목록에서 지운 펀드는 되살리지 않는다(캐시 삭제·기록 생략). 목록을 못 읽으면 판단 불가라 기록한다.
 * 판단은 갱신 시작 때 잡은 계정(uid)의 목록으로 — 도중에 계정이 바뀌었으면(A→B·로그아웃) 캐시 삭제·기록 모두 건너뛴다.
 */
export async function recordIfRegistered(
  fund: FundEntry,
  entry: CacheEntry,
  uid: number,
  deps = { loadFunds, deleteCache, recordFetched, ownerId: currentOwnerIdOrNull },
): Promise<boolean> {
  const funds = await deps.loadFunds(uid).catch(() => null);
  if (deps.ownerId() !== uid) return false; // 읽는 사이 계정이 바뀌었을 수 있어 부수 효과 직전에 확인
  if (funds && !funds.some((f) => f.id === fund.id)) {
    deps.deleteCache(fund.id);
    return false;
  }
  return deps.recordFetched(fund, entry, { backup: false });
}

let addedThisRun = false;
let runUid: number | null = null; // 이번 갱신을 시작한 계정 — single-flight 라 실행이 겹치지 않는다

export const fundRefresher = createAutoRefresher({
  // 갱신 시작 때 소유자를 한 번 잡는다(로그인 안 됨이면 던져 이번 실행은 목록 읽기 실패로 끝남)
  loadFunds: () => {
    runUid = null;
    const uid = currentOwnerId();
    runUid = uid;
    return loadFunds(uid);
  },
  deps: { fetchHtml: (u) => fetchReportHtml(u), cache: fileCache, now: Date.now },
  onRefreshed: async (fund, entry) => {
    const uid = runUid;
    if (uid !== null && (await recordIfRegistered(fund, entry, uid))) addedThisRun = true;
  },
});

/** 갱신 도중 다른 곳(리포트 화면)이 새 날짜를 기록했을 때 — 백업을 이번 갱신 끝으로 미룬다. 이미 끝났으면 바로. */
export function markAddedDuringRun(): void {
  if (fundRefresher.getStatus().running) addedThisRun = true;
  else void maybeAutoBackup();
}

// 백업은 이번 갱신의 모든 펀드를 기록한 뒤 1번 — 첫 펀드에서 하면 나머지 기록이 다음 날까지 Drive 에 빠진다.
// 백그라운드 태스크 안이면 백업하지 않고 표시만(구글 토큰 갱신이 화면 없이 실패할 수 있고 시간이 짧다)
fundRefresher.subscribe(() => {
  if (!fundRefresher.getStatus().running && addedThisRun) {
    addedThisRun = false;
    if (isBackgroundRun()) markBackupPending();
    else void maybeAutoBackup();
  }
});

/** 백그라운드에서 미뤄 둔 백업 — 앱이 앞에 와서 자동 갱신이 끝난 뒤 */
export function flushPendingBackup(deps = { takeBackupPending, maybeAutoBackup }): void {
  if (deps.takeBackupPending()) void deps.maybeAutoBackup();
}

/** 루트 레이아웃에서 한 번 — 로그인 상태일 때 시작 1회 + 백그라운드에서 돌아올 때마다 */
export function useFundAutoRefresh(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    if (!loggedIn) return;
    void fundRefresher.run().then(() => flushPendingBackup());
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev !== 'active' && next === 'active') void fundRefresher.run().then(() => flushPendingBackup());
      prev = next;
    });
    return () => sub.remove();
  }, [loggedIn]);
}

// 앱 실행·복귀 때 등록한 펀드를 모두 다시 가져온다(10분 이내 확인한 펀드는 건너뜀). 성공한 펀드는 히스토리에 기록.
// 로직(건너뛰기·동시 2개·single-flight)은 core createAutoRefresher — 여기선 앱 저장소·실행 시점만 연결.
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuthStore } from '@/features/auth/store';

import { createAutoRefresher, fetchReportHtml } from './core';
import { fileCache, loadFunds } from './fund-store';
import { recordFetched } from './record';

export const fundRefresher = createAutoRefresher({
  loadFunds,
  deps: { fetchHtml: (u) => fetchReportHtml(u), cache: fileCache, now: Date.now },
  onRefreshed: recordFetched,
});

/** 루트 레이아웃에서 한 번 — 로그인 상태일 때 시작 1회 + 백그라운드에서 돌아올 때마다 */
export function useFundAutoRefresh(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  useEffect(() => {
    if (!loggedIn) return;
    void fundRefresher.run();
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev !== 'active' && next === 'active') void fundRefresher.run();
      prev = next;
    });
    return () => sub.remove();
  }, [loggedIn]);
}

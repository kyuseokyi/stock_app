// 백그라운드 태스크 2개 — 화면 없이 깨어날 때도 등록돼 있어야 하므로 모듈 최상위에서 정의한다(엔트리 index.ts 가 import).
// push: 관리자 발송의 깨우기용 메시지(type 'fund_refresh') / periodic: 6시간 안팎(OS 재량) 안전망.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { isPushConfigured } from '@/features/push/config';

import { fundRefresher } from '../auto-refresh';
import { loadFunds } from '../fund-store';
import { enterBackgroundRun } from './background-mode';
import { createPeriodicSyncer } from './periodic-core';
import { pushTypeOf } from './push-payload';
import { backgroundRecordWith, type RunReason } from './run-core';

export const PUSH_TASK = 'fund-refresh-push';
export const PERIODIC_TASK = 'fund-refresh-periodic';
const PERIODIC_MINUTES = 360;

const backgroundRecord = (reason: RunReason) =>
  backgroundRecordWith(reason, {
    hydrate: () => useAuthStore.getState().hydrate(),
    isLoggedIn: () => useAuthStore.getState().user !== null,
    run: (o) => fundRefresher.run(o),
    enter: enterBackgroundRun,
    // 앞 화면에서 표시를 켜면 백업이 다음 background→active 까지 미뤄진다 — 앞이면 표시 없이 일반 경로(즉시 백업)
    isForeground: () => AppState.currentState === 'active',
  });

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error) return;
  if (__DEV__) console.log('[fund-bg] push payload', JSON.stringify(data).slice(0, 500)); // 실제 모양 확인용(S5-6)
  if (pushTypeOf(data) !== 'fund_refresh') return;
  if (AppState.currentState === 'active') return; // 앞에 있으면 SSE·자동 갱신이 이미 처리
  await backgroundRecord('push');
});

TaskManager.defineTask(PERIODIC_TASK, async () => {
  if (__DEV__) console.log('[fund-bg] periodic start');
  try {
    await backgroundRecord('periodic');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// push 태스크는 푸시가 설정됐으면 항상 등록 — 서버는 펀드를 등록한 기기에만 보낸다(Expo 문서: 모듈 최상위에서 등록)
if (isPushConfigured()) void Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});

// 정기 작업 등록·해제는 이 syncer 하나로만 — 복원(hydrated) 전엔 건드리지 않고, 동시 호출은 한 줄로 세운다
const periodic = createPeriodicSyncer({
  isHydrated: () => useAuthStore.getState().hydrated,
  loadDeps: async () => {
    const loggedIn = useAuthStore.getState().user !== null;
    const funds = loggedIn ? await loadFunds().catch(() => []) : [];
    return {
      want: loggedIn && funds.length > 0,
      available: async () =>
        (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available,
      isRegistered: () => TaskManager.isTaskRegisteredAsync(PERIODIC_TASK),
      register: () => BackgroundTask.registerTaskAsync(PERIODIC_TASK, { minimumInterval: PERIODIC_MINUTES }),
      unregister: () => BackgroundTask.unregisterTaskAsync(PERIODIC_TASK),
    };
  },
  unregister: () => BackgroundTask.unregisterTaskAsync(PERIODIC_TASK),
});

/** 정기 작업: 로그인 + 펀드 ≥1 이면 등록, 아니면 해제. 푸시 설정·권한과 무관 */
export async function syncBackgroundTasks(): Promise<void> {
  const r = await periodic.sync();
  if (__DEV__) console.log('[fund-bg] periodic sync', r);
}

/** 루트 레이아웃에서 한 번 — 로그인 복원 뒤 동기화, 로그아웃 직전 해제 */
export function useBackgroundTasks(): void {
  const loggedIn = useAuthStore((s) => s.user !== null);
  const hydrated = useAuthStore((s) => s.hydrated);
  useEffect(() => {
    const off = registerBeforeLogout(() => {
      void periodic.unregister();
    });
    return () => {
      off(); // 반환값(Set.delete 의 boolean)을 cleanup 으로 넘기지 않게 감싼다
    };
  }, []);
  useEffect(() => {
    if (hydrated) void syncBackgroundTasks(); // 복원 전(user=null)에 돌면 매 실행마다 해제됐다 재등록된다(syncer 도 한 번 더 막는다)
  }, [hydrated, loggedIn]);
}

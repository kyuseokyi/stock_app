// 백그라운드 태스크 2개 — 화면 없이 깨어날 때도 등록돼 있어야 하므로 모듈 최상위에서 정의한다(엔트리 index.ts 가 import).
// 이 JS 는 expo-background-task·expo-task-manager 가 들어간 재빌드 바이너리에서만 실행된다(옛 바이너리에서는 import 단계에서 실패).
// push: 관리자 발송의 깨우기용 메시지(type 'fund_refresh') / periodic: 6시간 안팎(OS 재량) 안전망.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { AppRegistry, AppState, LogBox, Platform } from 'react-native';

import { registerBeforeLogout } from '@/features/auth/logout-hooks';
import { useAuthStore } from '@/features/auth/store';
import { isPushConfigured } from '@/features/push/config';

import { fundRefresher } from '../auto-refresh';
import { loadFunds } from '../fund-store';
import { enterBackgroundRun } from './background-mode';
import { createPeriodicSyncer } from './periodic-core';
import { pushTypeOf } from './push-payload';
import { BACKGROUND_TIMEOUT_MS, backgroundRecordWith, type RunReason } from './run-core';

// [Android 콜드 시작 보정] expo-task-manager(57.0.21) 는 태스크 이벤트 때 네이티브에서 headless 작업 'expo-task-manager' 를
// 시작해 JS 타이머를 살려 두려 하지만, JS 쪽에 즉시 끝나는 no-op(async () => {}) 을 등록해 두어 RN 이 그 작업을 바로 끝낸다
// → JavaTimerManager 가 다시 멈춰, 화면이 한 번도 안 뜬 콜드 시작에서는 setTimeout(지터·25초 한도·fetch 타임아웃)이 영영 안 돈다.
// 실기기(2026-10-21, Android 16, release·dev 둘 다)에서 앱을 밀어 닫고 무음 push → 태스크가 3분 넘게 안 끝남, 앱을 열자 2초 만에 끝남.
// → 같은 키를 우리 한도보다 조금 긴 시간 동안 끝나지 않는 provider 로 덮어쓴다. 실제 종료는 Expo 네이티브(maybeFinishHeadlessTask)가 한다.
//   이 import 순서(위에서 expo-task-manager 먼저 평가)여야 덮어쓴다. 이미 끝난 작업을 다시 끝내면 RN 은 경고 로그만 남긴다.
const HEADLESS_HOLD_MS = BACKGROUND_TIMEOUT_MS + 5_000;
if (Platform.OS === 'android') {
  LogBox.ignoreLogs([`called multiple times for same key 'expo-task-manager'`]); // 의도한 덮어쓰기
  AppRegistry.registerHeadlessTask('expo-task-manager', () => () =>
    new Promise<void>((resolve) => setTimeout(resolve, HEADLESS_HOLD_MS)),
  );
}

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
    isForeground: () => {
      const fg = AppState.currentState === 'active';
      if (fg && __DEV__) console.log('[fund-bg] periodic foreground'); // 정기 작업은 보통 headless — 'active' 오판 구분용
      return fg;
    },
  });

const safeJson = (v: unknown): string => {
  try {
    return String(JSON.stringify(v) ?? '').slice(0, 500);
  } catch {
    return '<unserializable>'; // 순환 참조 등
  }
};

// 모듈 최상위 정의·등록은 동기 throw 해도 앱 시작을 막지 않게 감싼다(.catch 는 Promise 실패만 잡는다)
try {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
    if (error) return;
    if (__DEV__) console.log('[fund-bg] push payload', safeJson(data)); // 실제 모양 확인용(S5-6)
    if (pushTypeOf(data) !== 'fund_refresh') return;
    if (AppState.currentState === 'active') {
      if (__DEV__) console.log('[fund-bg] skip: foreground'); // headless 인데 'active' 로 오판했는지 구분용
      return; // 앞에 있으면 SSE·자동 갱신이 이미 처리
    }
    await backgroundRecord('push');
  });

  TaskManager.defineTask(PERIODIC_TASK, async () => {
    if (__DEV__) console.log('[fund-bg] periodic start');
    try {
      await backgroundRecord('periodic');
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
    // skipped(로그아웃)·timeout 이어도 Success — 다음 주기에 어차피 다시 돌고, Failed 로 보고하면 OS 가 재시도 간격을 늘릴 수 있다(의도된 동작)
    return BackgroundTask.BackgroundTaskResult.Success;
  });

  // push 태스크는 푸시가 설정됐으면 항상 등록 — 서버는 펀드를 등록한 기기에만 보낸다(Expo 문서: 모듈 최상위에서 등록)
  if (isPushConfigured()) void Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
} catch (e) {
  if (__DEV__) console.log('[fund-bg] define/register failed', String(e));
}

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

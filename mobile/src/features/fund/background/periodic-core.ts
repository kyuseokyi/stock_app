import { createSerialQueue } from '@/features/push/registration-core';

// 정기 백그라운드 작업 등록·해제 판단(로그인 + 펀드 ≥1 일 때만). 푸시 설정·권한과는 무관.
export type PeriodicDeps = {
  want: boolean;
  available: () => Promise<boolean>; // OS 가 백그라운드 작업을 허용하는지
  isRegistered: () => Promise<boolean>;
  register: () => Promise<void>;
  unregister: () => Promise<void>;
};

export type PeriodicResult =
  'registered' | 'unregistered' | 'unchanged' | 'unavailable' | 'failed';

export async function syncPeriodicTaskWith(
  d: PeriodicDeps,
): Promise<PeriodicResult> {
  try {
    const has = await d.isRegistered();
    if (!d.want) {
      if (!has) return 'unchanged';
      await d.unregister();
      return 'unregistered';
    }
    if (has) return 'unchanged';
    if (!(await d.available())) return 'unavailable';
    await d.register();
    return 'registered';
  } catch {
    return 'failed'; // 다음 동기화 시점(앱 실행·펀드 추가/삭제·로그인)에 다시
  }
}

export type SyncerDeps = {
  isHydrated: () => boolean; // 로그인 복원 끝 — 전에는 user=null 이라 정기 작업이 해제됐다 재등록된다
  loadDeps: () => Promise<PeriodicDeps>; // 실행 시점의 로그인·펀드 상태로 만든 의존성(큐 안에서 읽어 항상 최신)
  unregister: () => Promise<void>; // 로그아웃 직전 해제
};

/** 등록·해제 호출을 한 줄로 세워 동시 호출(로그인 직후 + 펀드 추가 등)이 엇갈리지 않게 하고, 복원 전에는 건드리지 않는다 */
export function createPeriodicSyncer(d: SyncerDeps) {
  const serial = createSerialQueue();
  return {
    sync: (): Promise<PeriodicResult | 'skipped'> =>
      serial(async () => {
        if (!d.isHydrated()) return 'skipped' as const;
        try {
          return await syncPeriodicTaskWith(await d.loadDeps());
        } catch {
          return 'failed' as const;
        }
      }),
    unregister: (): Promise<void> =>
      serial(async () => {
        try {
          await d.unregister();
        } catch {
          // 해제 실패는 다음 동기화(want=false)에서 다시
        }
      }),
  };
}

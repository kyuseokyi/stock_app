// 푸시 토큰 등록 동기화 — 순수 로직(의존성 주입). 실패는 조용히(다음 시점 재시도).
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export type SyncDeps = {
  isConfigured: () => boolean;
  authToken: () => string | null;
  countFunds: () => Promise<number>;
  permission: () => Promise<PushPermission>;
  getPushToken: () => Promise<string>;
  loadSaved: () => Promise<string | null>;
  saveToken: (token: string | null) => Promise<void>;
  put: (authToken: string, pushToken: string) => Promise<void>;
  del: (authToken: string, pushToken: string) => Promise<void>;
};

export type SyncResult = 'skipped' | 'registered' | 'unchanged' | 'unregistered' | 'idle' | 'failed';

/** 로그인 + 펀드 ≥1 + 권한 허용 → 등록(토큰이 바뀌었을 때만 PUT). 아니면 등록돼 있던 토큰을 해제 */
export async function syncPushRegistrationWith(d: SyncDeps): Promise<SyncResult> {
  if (!d.isConfigured()) return 'skipped';
  try {
    const auth = d.authToken();
    if (!auth) return 'idle'; // 로그아웃 해제는 unregisterWith(로그아웃 직전 훅)가 맡는다
    const saved = await d.loadSaved();
    const wanted = (await d.countFunds()) > 0 && (await d.permission()) === 'granted';
    if (wanted) {
      const token = await d.getPushToken();
      if (token === saved) return 'unchanged';
      await d.put(auth, token);
      await d.saveToken(token);
      return 'registered';
    }
    if (!saved) return 'idle';
    await d.del(auth, saved);
    await d.saveToken(null);
    return 'unregistered';
  } catch {
    return 'failed';
  }
}

/** 한 번에 하나씩 순서대로 실행하는 Promise 큐 — 앞 작업이 실패해도 다음은 실행된다 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

/** 로그아웃 직전 — 지워지기 전 인증 토큰을 받아 해제. 서버 실패여도 기기 기록은 비운다 */
export async function unregisterWith(
  d: Pick<SyncDeps, 'loadSaved' | 'saveToken' | 'del'>,
  authToken: string,
): Promise<void> {
  const saved = await d.loadSaved().catch(() => null);
  if (!saved) return;
  await d.del(authToken, saved).catch(() => {});
  await d.saveToken(null).catch(() => {});
}

export const PUSH_TIMEOUT_MS = 10_000;

/** ms 안에 안 끝나면 reject(끝나면 타이머 정리) — 멈춘 네트워크가 직렬화 큐를 막지 않게 */
export function withTimeout<T>(task: Promise<T>, ms: number, label = 'push'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    task.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 동기화와 해제를 한 큐로 직렬화 — 진행 중인 put 이 끝난 뒤 해제가 실행돼 "로그아웃 후 등록 잔존"이 없다 */
export function createPushRegistrar(d: SyncDeps) {
  const enqueue = createSerialQueue();
  let pendingSync: Promise<SyncResult> | null = null;
  return {
    // 아직 시작 전인 sync 가 큐에 있으면 새 요청은 그 결과를 공유(합치기). unregister 는 합치지 않는다
    sync: () => {
      if (pendingSync) return pendingSync;
      // 내 시작 시점에 pendingSync 가 아직 나라면 비운다(unregister 뒤 새로 선 sync 의 합치기 대상을 지우지 않게)
      const p: Promise<SyncResult> = enqueue(() => {
        if (pendingSync === p) pendingSync = null;
        return syncPushRegistrationWith(d);
      });
      pendingSync = p;
      return p;
    },
    // 해제 뒤에 들어오는 sync 가 해제 앞의 대기 sync 에 합쳐져 해제보다 먼저 실행되지 않게 합치기 대상을 끊는다
    unregister: (authToken: string) => {
      pendingSync = null;
      return enqueue(() => unregisterWith(d, authToken));
    },
  };
}

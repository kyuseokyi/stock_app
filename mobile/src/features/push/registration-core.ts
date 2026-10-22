// 푸시 토큰 등록 동기화 — 순수 로직(의존성 주입). 실패는 조용히(다음 시점 재시도).
export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** 서버에 함께 보내는 알림 종류별 수신 여부 */
export type PushFlags = { fundNotice: boolean; postNotice: boolean };

/** 기기에 저장한 마지막 등록. 구버전 저장값(토큰만)은 플래그가 null */
export type SavedDevice = { token: string; fundNotice: boolean | null; postNotice: boolean | null };

export type SyncDeps = {
  isConfigured: () => boolean;
  authToken: () => string | null;
  countFunds: () => Promise<number>;
  postNotice: () => Promise<boolean>;
  permission: () => Promise<PushPermission>;
  getPushToken: () => Promise<string>;
  loadSaved: () => Promise<string | null>;
  saveSaved: (raw: string | null) => Promise<void>;
  put: (authToken: string, pushToken: string, flags: PushFlags) => Promise<void>;
  del: (authToken: string, pushToken: string) => Promise<void>;
};

export type SyncResult = 'skipped' | 'registered' | 'unchanged' | 'unregistered' | 'idle' | 'failed';

/** 새 글 알림 설정 저장값 → 켜짐 여부. '0' 만 꺼짐(없으면 기본 켜짐) */
export const parsePostNotice = (raw: string | null): boolean => raw !== '0';

export function encodeSaved(token: string, f: PushFlags): string {
  return JSON.stringify({ v: 2, token, fund: f.fundNotice, post: f.postNotice });
}

/**
 * 저장값 해석. '{' 로 시작하면 새 형식(JSON), 아니면 구버전(Expo 토큰 문자열 그대로) — 플래그 null 이라
 * 서명이 달라 한 번 다시 PUT 된다. 깨진 JSON 은 null(저장 없음으로 보고 다시 등록).
 */
export function decodeSaved(raw: string | null): SavedDevice | null {
  if (!raw) return null;
  if (!raw.startsWith('{')) return { token: raw, fundNotice: null, postNotice: null };
  try {
    const o = JSON.parse(raw) as { token?: unknown; fund?: unknown; post?: unknown };
    if (typeof o.token !== 'string' || !o.token) return null;
    return {
      token: o.token,
      fundNotice: typeof o.fund === 'boolean' ? o.fund : null,
      postNotice: typeof o.post === 'boolean' ? o.post : null,
    };
  } catch {
    return null;
  }
}

/** 토큰과 두 플래그가 모두 같을 때만 같은 등록(→ PUT 생략) */
export function sameRegistration(saved: SavedDevice | null, token: string, f: PushFlags): boolean {
  return (
    saved !== null && saved.token === token && saved.fundNotice === f.fundNotice && saved.postNotice === f.postNotice
  );
}

/**
 * 로그인 + 권한 허용 → 등록(펀드 0개여도). 플래그: fund = 펀드 ≥1, post = 내정보 설정.
 * 토큰이나 플래그가 바뀌었을 때만 PUT. 권한이 없으면 등록돼 있던 토큰을 해제
 */
export async function syncPushRegistrationWith(d: SyncDeps): Promise<SyncResult> {
  if (!d.isConfigured()) return 'skipped';
  try {
    const auth = d.authToken();
    if (!auth) return 'idle'; // 로그아웃 해제는 unregisterWith(로그아웃 직전 훅)가 맡는다
    const saved = decodeSaved(await d.loadSaved());
    if ((await d.permission()) === 'granted') {
      const flags: PushFlags = { fundNotice: (await d.countFunds()) > 0, postNotice: await d.postNotice() };
      const token = await d.getPushToken();
      if (sameRegistration(saved, token, flags)) return 'unchanged';
      await d.put(auth, token, flags);
      await d.saveSaved(encodeSaved(token, flags));
      return 'registered';
    }
    if (!saved) return 'idle';
    await d.del(auth, saved.token);
    await d.saveSaved(null);
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
  d: Pick<SyncDeps, 'loadSaved' | 'saveSaved' | 'del'>,
  authToken: string,
): Promise<void> {
  const saved = decodeSaved(await d.loadSaved().catch(() => null));
  if (!saved) return;
  await d.del(authToken, saved.token).catch(() => {});
  await d.saveSaved(null).catch(() => {});
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
export function createPushRegistrar(
  d: SyncDeps,
  // 로그아웃 해제용 의존성(기본 d) — 해제는 훅이 넘긴 토큰을 그대로 써야 해서 갱신 래퍼 없는 del 을 따로 줄 수 있다
  unregisterDeps: Pick<SyncDeps, 'loadSaved' | 'saveSaved' | 'del'> = d,
) {
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
      return enqueue(() => unregisterWith(unregisterDeps, authToken));
    },
  };
}

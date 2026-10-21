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

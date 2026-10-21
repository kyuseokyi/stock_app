import { createPushRegistrar, syncPushRegistrationWith, unregisterWith, withTimeout, type SyncDeps } from './registration-core';

const mk = (over: Partial<SyncDeps> = {}) => {
  const saved = { v: null as string | null };
  const d: SyncDeps = {
    isConfigured: () => true,
    authToken: () => 'jwt',
    countFunds: async () => 1,
    permission: async () => 'granted',
    getPushToken: async () => 'ExponentPushToken[a]',
    loadSaved: async () => saved.v,
    saveToken: jest.fn(async (t: string | null) => {
      saved.v = t;
    }),
    put: jest.fn(async () => {}),
    del: jest.fn(async () => {}),
    ...over,
  };
  return { d, saved };
};

describe('syncPushRegistrationWith', () => {
  it('설정 안 됨이면 아무것도 안 한다', async () => {
    const { d } = mk({ isConfigured: () => false });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('skipped');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그인·펀드·권한이 모두 있으면 PUT 하고 저장한다', async () => {
    const { d, saved } = mk();
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBe('ExponentPushToken[a]');
  });

  it('저장된 토큰과 같으면 PUT 을 생략한다', async () => {
    const { d, saved } = mk();
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('펀드가 0개면 등록된 토큰을 DELETE 한다', async () => {
    const { d, saved } = mk({ countFunds: async () => 0 });
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unregistered');
    expect(d.del).toHaveBeenCalledWith('jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBeNull();
  });

  it('권한이 없으면 등록하지 않는다', async () => {
    const { d } = mk({ permission: async () => 'denied' });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그아웃 상태면 서버 호출 없이 끝난다', async () => {
    const { d, saved } = mk({ authToken: () => null });
    saved.v = 'ExponentPushToken[a]';
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.del).not.toHaveBeenCalled();
  });

  it('실패는 조용히 failed 로 끝나고 저장값은 그대로', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('failed');
    expect(saved.v).toBeNull();
  });
});

describe('unregisterWith', () => {
  it('저장된 토큰을 주어진 인증 토큰으로 지우고 비운다(실패해도 비운다)', async () => {
    const { d, saved } = mk({ del: jest.fn(async () => Promise.reject(new Error('401'))) });
    saved.v = 'ExponentPushToken[a]';
    await unregisterWith(d, 'old-jwt');
    expect(d.del).toHaveBeenCalledWith('old-jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBeNull();
  });

  it('저장된 토큰이 없으면 호출하지 않는다', async () => {
    const { d } = mk();
    await unregisterWith(d, 'jwt');
    expect(d.del).not.toHaveBeenCalled();
  });
});

describe('createPushRegistrar (직렬화)', () => {
  it('put 진행 중 해제 요청이 오면 최종 상태가 해제됨', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, saved } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s = reg.sync(); // put 대기 중
    const u = reg.unregister('jwt'); // 로그아웃 훅
    release();
    await expect(s).resolves.toBe('registered');
    await u;
    expect(d.del).toHaveBeenCalledWith('jwt', 'ExponentPushToken[a]');
    expect(saved.v).toBeNull();
  });

  it('앞 작업이 실패해도 다음 작업은 실행된다', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    const reg = createPushRegistrar(d);
    await expect(reg.sync()).resolves.toBe('failed');
    saved.v = 'ExponentPushToken[a]';
    await reg.unregister('jwt');
    expect(saved.v).toBeNull();
  });
});

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('시간 안에 안 끝나면 reject', async () => {
    const p = withTimeout(new Promise<void>(() => {}), 1000);
    const assertion = expect(p).rejects.toThrow('timeout');
    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('끝나면 값을 돌려주고 타이머를 정리한다', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('원본이 reject 되면 그대로 전달하고 타이머를 정리한다', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('토큰 조회가 멈춰 timeout 되면 sync 는 failed 로 끝난다', async () => {
    const { d } = mk({ getPushToken: () => withTimeout(new Promise<string>(() => {}), 1000) });
    const r = syncPushRegistrationWith(d);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(r).resolves.toBe('failed');
  });
});

describe('createPushRegistrar 합치기', () => {
  it('대기 중인 sync 가 있으면 새 sync 요청을 합친다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s1 = reg.sync(); // 실행 시작(put 대기)
    await Promise.resolve();
    const s2 = reg.sync(); // 큐에서 대기
    const s3 = reg.sync(); // s2 와 합쳐짐
    expect(s3).toBe(s2);
    release();
    await Promise.all([s1, s2]);
    expect(d.put).toHaveBeenCalledTimes(1); // 두 번째는 토큰 같아 unchanged
  });
});

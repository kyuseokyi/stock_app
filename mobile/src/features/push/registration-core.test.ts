import {
  createPushRegistrar,
  decodeSaved,
  encodeSaved,
  parsePostNotice,
  sameRegistration,
  syncPushRegistrationWith,
  unregisterWith,
  withTimeout,
  type SyncDeps,
} from './registration-core';

const TOKEN = 'ExponentPushToken[a]';
const BOTH_ON = { fundNotice: true, postNotice: true };

const mk = (over: Partial<SyncDeps> = {}) => {
  const saved = { v: null as string | null };
  const d: SyncDeps = {
    isConfigured: () => true,
    authToken: () => 'jwt',
    countFunds: async () => 1,
    postNotice: async () => true,
    permission: async () => 'granted',
    getPushToken: async () => TOKEN,
    loadSaved: async () => saved.v,
    saveSaved: jest.fn(async (raw: string | null) => {
      saved.v = raw;
    }),
    put: jest.fn(async () => {}),
    del: jest.fn(async () => {}),
    ...over,
  };
  return { d, saved };
};

describe('저장값 서명', () => {
  it('encode → decode 왕복', () => {
    expect(decodeSaved(encodeSaved(TOKEN, { fundNotice: false, postNotice: true }))).toEqual({
      token: TOKEN,
      fundNotice: false,
      postNotice: true,
    });
  });

  it('구버전 값(토큰 문자열만)은 플래그 null 로 읽는다', () => {
    expect(decodeSaved(TOKEN)).toEqual({ token: TOKEN, fundNotice: null, postNotice: null });
  });

  it('비었거나 깨진 값은 null', () => {
    expect(decodeSaved(null)).toBeNull();
    expect(decodeSaved('')).toBeNull();
    expect(decodeSaved('{broken')).toBeNull();
    expect(decodeSaved('{"v":2}')).toBeNull();
  });

  it('토큰·두 플래그가 모두 같아야 같은 등록', () => {
    const s = decodeSaved(encodeSaved(TOKEN, BOTH_ON));
    expect(sameRegistration(s, TOKEN, BOTH_ON)).toBe(true);
    expect(sameRegistration(s, TOKEN, { fundNotice: true, postNotice: false })).toBe(false);
    expect(sameRegistration(s, TOKEN, { fundNotice: false, postNotice: true })).toBe(false);
    expect(sameRegistration(s, 'ExponentPushToken[b]', BOTH_ON)).toBe(false);
    expect(sameRegistration(decodeSaved(TOKEN), TOKEN, BOTH_ON)).toBe(false); // 구버전 → 다시 PUT
    expect(sameRegistration(null, TOKEN, BOTH_ON)).toBe(false);
  });
});

describe('parsePostNotice', () => {
  it("저장값이 '0' 일 때만 꺼짐, 없으면 기본 켜짐", () => {
    expect(parsePostNotice(null)).toBe(true);
    expect(parsePostNotice('1')).toBe(true);
    expect(parsePostNotice('0')).toBe(false);
  });
});

describe('syncPushRegistrationWith', () => {
  it('설정 안 됨이면 아무것도 안 한다', async () => {
    const { d } = mk({ isConfigured: () => false });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('skipped');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('로그인·권한이 있으면 두 플래그와 함께 PUT 하고 서명을 저장한다', async () => {
    const { d, saved } = mk();
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, BOTH_ON);
    expect(decodeSaved(saved.v)).toEqual({ token: TOKEN, ...BOTH_ON });
  });

  it('펀드가 0개여도 등록한다(fund_notice=false)', async () => {
    const { d, saved } = mk({ countFunds: async () => 0 });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, { fundNotice: false, postNotice: true });
    expect(d.del).not.toHaveBeenCalled();
    expect(decodeSaved(saved.v)?.fundNotice).toBe(false);
  });

  it('새 글 알림을 끄면 post_notice=false 로 등록한다', async () => {
    const { d } = mk({ postNotice: async () => false });
    await syncPushRegistrationWith(d);
    expect(d.put).toHaveBeenCalledWith('jwt', TOKEN, { fundNotice: true, postNotice: false });
  });

  it('토큰·플래그가 저장값과 같으면 PUT 을 생략한다', async () => {
    const { d, saved } = mk();
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).not.toHaveBeenCalled();
  });

  it('플래그만 바뀌어도 다시 PUT 한다', async () => {
    const { d, saved } = mk({ postNotice: async () => false });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledTimes(1);
    expect(decodeSaved(saved.v)?.postNotice).toBe(false);
  });

  it('구버전 저장값(토큰만)이면 한 번 다시 PUT 하고 새 형식으로 바꾼다', async () => {
    const { d, saved } = mk();
    saved.v = TOKEN;
    await expect(syncPushRegistrationWith(d)).resolves.toBe('registered');
    expect(d.put).toHaveBeenCalledTimes(1);
    expect(saved.v).toBe(encodeSaved(TOKEN, BOTH_ON));
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unchanged');
    expect(d.put).toHaveBeenCalledTimes(1);
  });

  it('권한이 없어지면 저장된 순수 토큰으로 DELETE 한다', async () => {
    const { d, saved } = mk({ permission: async () => 'denied' });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('unregistered');
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('권한이 없고 저장값도 없으면 아무것도 안 한다', async () => {
    const { d } = mk({ permission: async () => 'denied' });
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.put).not.toHaveBeenCalled();
    expect(d.del).not.toHaveBeenCalled();
  });

  it('로그아웃 상태면 서버 호출 없이 끝난다', async () => {
    const { d, saved } = mk({ authToken: () => null });
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await expect(syncPushRegistrationWith(d)).resolves.toBe('idle');
    expect(d.del).not.toHaveBeenCalled();
    expect(d.put).not.toHaveBeenCalled();
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
    saved.v = encodeSaved(TOKEN, BOTH_ON);
    await unregisterWith(d, 'old-jwt');
    expect(d.del).toHaveBeenCalledWith('old-jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('구버전 저장값(토큰만)도 순수 토큰으로 지운다', async () => {
    const { d, saved } = mk();
    saved.v = TOKEN;
    await unregisterWith(d, 'jwt');
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
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
    expect(d.del).toHaveBeenCalledWith('jwt', TOKEN);
    expect(saved.v).toBeNull();
  });

  it('앞 작업이 실패해도 다음 작업은 실행된다', async () => {
    const { d, saved } = mk({ put: jest.fn(async () => Promise.reject(new Error('net'))) });
    const reg = createPushRegistrar(d);
    await expect(reg.sync()).resolves.toBe('failed');
    saved.v = encodeSaved(TOKEN, BOTH_ON);
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
    expect(d.put).toHaveBeenCalledTimes(1); // 두 번째는 서명이 같아 unchanged
  });

  it('대기 sync → unregister → 새 sync 는 합쳐지지 않고 해제 뒤에 실행되어 최종 등록된다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, saved } = mk({ put: jest.fn(() => gate) });
    const reg = createPushRegistrar(d);
    const s1 = reg.sync(); // 실행 시작(put 대기)
    await Promise.resolve();
    const s2 = reg.sync(); // 큐에서 대기
    const u = reg.unregister('jwt');
    const s3 = reg.sync(); // 해제 뒤에 새로 줄을 서야 함
    expect(s3).not.toBe(s2);
    release();
    await Promise.all([s1, s2, u]);
    await expect(s3).resolves.toBe('registered');
    expect(decodeSaved(saved.v)?.token).toBe(TOKEN);
  });
});

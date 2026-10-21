import {
  createPeriodicSyncer,
  syncPeriodicTaskWith,
  type PeriodicDeps,
  type SyncerDeps,
} from './periodic-core';

const deps = (over: Partial<PeriodicDeps> = {}): PeriodicDeps => ({
  want: true,
  available: jest.fn(async () => true),
  isRegistered: jest.fn(async () => false),
  register: jest.fn(async () => {}),
  unregister: jest.fn(async () => {}),
  ...over,
});

it('원하는데 없으면 등록', async () => {
  const d = deps();
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('registered');
  expect(d.register).toHaveBeenCalledTimes(1);
});

it('이미 등록돼 있으면 그대로', async () => {
  const d = deps({ isRegistered: async () => true });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unchanged');
  expect(d.register).not.toHaveBeenCalled();
});

it('원하지 않는데 있으면 해제', async () => {
  const d = deps({ want: false, isRegistered: async () => true });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unregistered');
  expect(d.unregister).toHaveBeenCalledTimes(1);
});

it('OS 가 막아 두면(Restricted) 등록하지 않는다', async () => {
  const d = deps({ available: async () => false });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unavailable');
  expect(d.register).not.toHaveBeenCalled();
});

it('오류는 삼키고 failed', async () => {
  const d = deps({ isRegistered: async () => Promise.reject(new Error('x')) });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('failed');
});

it('register 가 throw 하면 failed', async () => {
  const d = deps({ register: async () => Promise.reject(new Error('x')) });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('failed');
});

it('unregister 가 throw 하면 failed', async () => {
  const d = deps({
    want: false,
    isRegistered: async () => true,
    unregister: async () => Promise.reject(new Error('x')),
  });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('failed');
});

it('원하지 않고 미등록이면 그대로', async () => {
  const d = deps({ want: false });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unchanged');
  expect(d.unregister).not.toHaveBeenCalled();
});

it('이미 등록돼 있으면 OS 제한이어도 그대로(available 을 묻지 않는다)', async () => {
  const d = deps({
    isRegistered: async () => true,
    available: jest.fn(async () => false),
  });
  await expect(syncPeriodicTaskWith(d)).resolves.toBe('unchanged');
  expect(d.available).not.toHaveBeenCalled();
});

describe('createPeriodicSyncer — 복원 게이트·직렬화', () => {
  const make = (over: Partial<SyncerDeps> = {}) => {
    let registered = false;
    const log: string[] = [];
    const d: SyncerDeps = {
      isHydrated: () => true,
      loadDeps: async () =>
        deps({
          want: true,
          isRegistered: async () => {
            log.push('has?');
            await Promise.resolve();
            return registered;
          },
          register: async () => {
            log.push('register');
            await Promise.resolve();
            registered = true;
          },
          unregister: async () => {
            log.push('unregister');
            registered = false;
          },
        }),
      unregister: async () => {
        log.push('unregister');
        registered = false;
      },
      ...over,
    };
    return { d, log };
  };

  it('로그인 복원(hydrated) 전에는 아무것도 하지 않는다(user=null 로 해제됐다 재등록되는 것 방지)', async () => {
    const loadDeps = jest.fn(async () => deps());
    const s = createPeriodicSyncer({ isHydrated: () => false, loadDeps, unregister: async () => {} });
    await expect(s.sync()).resolves.toBe('skipped');
    expect(loadDeps).not.toHaveBeenCalled();
  });

  it('동시에 두 번 불러도 한 번만 등록한다(둘 다 has=false 를 읽는 경합 방지)', async () => {
    const { d, log } = make();
    const s = createPeriodicSyncer(d);
    const [a, b] = await Promise.all([s.sync(), s.sync()]);
    expect([a, b]).toEqual(['registered', 'unchanged']);
    expect(log.filter((x) => x === 'register')).toHaveLength(1);
  });

  it('등록과 로그아웃 해제가 엇갈리지 않고 호출 순서대로 실행된다', async () => {
    const { d, log } = make();
    const s = createPeriodicSyncer(d);
    await Promise.all([s.sync(), s.unregister()]);
    expect(log).toEqual(['has?', 'register', 'unregister']);
  });

  it('앞 작업이 실패해도 다음 호출은 실행되고, loadDeps 오류는 failed', async () => {
    let n = 0;
    const s = createPeriodicSyncer({
      isHydrated: () => true,
      loadDeps: async () => {
        if (n++ === 0) throw new Error('x');
        return deps({ want: false, isRegistered: async () => false });
      },
      unregister: async () => {},
    });
    await expect(s.sync()).resolves.toBe('failed');
    await expect(s.sync()).resolves.toBe('unchanged');
  });

  it('unregister 가 실패해도 reject 하지 않는다', async () => {
    const s = createPeriodicSyncer({
      isHydrated: () => true,
      loadDeps: async () => deps(),
      unregister: async () => Promise.reject(new Error('x')),
    });
    await expect(s.unregister()).resolves.toBeUndefined();
  });
});

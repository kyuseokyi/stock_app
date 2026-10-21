import { syncPeriodicTaskWith, type PeriodicDeps } from './periodic-core';

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

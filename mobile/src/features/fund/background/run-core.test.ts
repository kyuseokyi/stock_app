import {
  enterBackgroundRun,
  isBackgroundRun,
  resetBackgroundRunForTest,
} from './background-mode';
import { backgroundRecordWith, type RunDeps } from './run-core';

const deps = (over: Partial<RunDeps> = {}) => {
  const leave = jest.fn();
  const d: RunDeps & { leave: jest.Mock } = {
    hydrate: jest.fn(async () => {}),
    isLoggedIn: jest.fn(() => true),
    run: jest.fn(async () => {}),
    enter: jest.fn(() => leave),
    timeoutMs: 50,
    random: () => 0,
    sleep: jest.fn(async () => {}),
    leave,
    ...over,
  };
  return d;
};

it('로그아웃 상태면 아무것도 하지 않는다', async () => {
  const d = deps({ isLoggedIn: () => false });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('skipped');
  expect(d.run).not.toHaveBeenCalled();
  expect(d.enter).not.toHaveBeenCalled();
});

it('hydrate 가 실패하면 건너뛴다', async () => {
  const d = deps({ hydrate: async () => Promise.reject(new Error('x')) });
  await expect(backgroundRecordWith('periodic', d)).resolves.toBe('skipped');
  expect(d.run).not.toHaveBeenCalled();
});

it('push 는 force, 정기 작업은 force 없이', async () => {
  const a = deps();
  await backgroundRecordWith('push', a);
  expect(a.run).toHaveBeenCalledWith({ force: true });
  const b = deps();
  await backgroundRecordWith('periodic', b);
  expect(b.run).toHaveBeenCalledWith({ force: false });
});

it('끝나면 백그라운드 표시를 끈다', async () => {
  const d = deps();
  await expect(backgroundRecordWith('push', d)).resolves.toBe('done');
  expect(d.enter).toHaveBeenCalledTimes(1);
  expect(d.leave).toHaveBeenCalledTimes(1);
});

describe('한도·경합 (fake timers)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('한도를 넘으면 timeout 으로 돌아오지만, 표시는 실행이 실제로 끝날 때 끈다', async () => {
    let finish: () => void = () => {};
    const d = deps({
      run: jest.fn(() => new Promise<void>((res) => (finish = res))),
    });
    const p = backgroundRecordWith('push', d);
    await jest.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('timeout');
    expect(d.leave).not.toHaveBeenCalled(); // 늦게 끝난 실행이 앞 화면처럼 백업하지 않게
    finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(d.leave).toHaveBeenCalledTimes(1);
  });

  it('한도 뒤에 run 이 reject 돼도 leave 는 1회', async () => {
    let fail: (e: Error) => void = () => {};
    const d = deps({
      run: jest.fn(() => new Promise<void>((_, rej) => (fail = rej))),
    });
    const p = backgroundRecordWith('periodic', d);
    await jest.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('timeout');
    fail(new Error('x'));
    await jest.advanceTimersByTimeAsync(0);
    expect(d.leave).toHaveBeenCalledTimes(1);
  });

  it('hydrate 가 멈춰도 한도에 timeout, 표시는 켠 적 없고 늦게 풀려도 갱신하지 않는다', async () => {
    let release: () => void = () => {};
    const d = deps({
      hydrate: () => new Promise<void>((res) => (release = res)),
    });
    const p = backgroundRecordWith('push', d);
    await jest.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBe('timeout');
    expect(d.enter).not.toHaveBeenCalled();
    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(d.enter).not.toHaveBeenCalled();
    expect(d.run).not.toHaveBeenCalled();
  });

  it('끝나면 한도 타이머를 정리한다', async () => {
    const d = deps();
    await backgroundRecordWith('periodic', d);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('두 실행이 겹치면 마지막 실행이 끝날 때에야 표시가 꺼진다', async () => {
    resetBackgroundRunForTest();
    let finishA: () => void = () => {};
    let finishB: () => void = () => {};
    const mk = (set: (f: () => void) => void) =>
      deps({
        enter: enterBackgroundRun,
        run: jest.fn(() => new Promise<void>((res) => set(res))),
      });
    const pa = backgroundRecordWith(
      'periodic',
      mk((f) => (finishA = f)),
    );
    const pb = backgroundRecordWith(
      'periodic',
      mk((f) => (finishB = f)),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(isBackgroundRun()).toBe(true);
    finishA();
    await jest.advanceTimersByTimeAsync(0);
    await pa;
    expect(isBackgroundRun()).toBe(true);
    finishB();
    await jest.advanceTimersByTimeAsync(0);
    await pb;
    expect(isBackgroundRun()).toBe(false);
  });
});

it('isLoggedIn 이 throw 해도 reject 하지 않고 skipped', async () => {
  const d = deps({
    isLoggedIn: () => {
      throw new Error('x');
    },
  });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('skipped');
  expect(d.enter).not.toHaveBeenCalled();
});

it('sleep 이 동기로 throw 해도 reject 하지 않고 leave 는 1회', async () => {
  const d = deps({
    random: () => 0.5,
    sleep: () => {
      throw new Error('x');
    },
  });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('done');
  expect(d.run).not.toHaveBeenCalled();
  expect(d.leave).toHaveBeenCalledTimes(1);
});

it('push 는 0~10초 무작위로 기다린 뒤 가져온다(모든 기기가 한꺼번에 원본을 치지 않게), 정기 작업은 바로', async () => {
  const a = deps({ random: () => 0.5 });
  await backgroundRecordWith('push', a);
  expect(a.sleep).toHaveBeenCalledWith(5_000);
  const b = deps({ random: () => 0.5 });
  await backgroundRecordWith('periodic', b);
  expect(b.sleep).not.toHaveBeenCalled();
});

it('실행이 실패해도 표시를 끄고 done', async () => {
  const d = deps({ run: jest.fn(async () => Promise.reject(new Error('x'))) });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('done');
  expect(d.leave).toHaveBeenCalledTimes(1);
});

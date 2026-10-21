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

it('한도를 넘으면 timeout 으로 돌아오지만, 표시는 실행이 실제로 끝날 때 끈다', async () => {
  let finish: () => void = () => {};
  const d = deps({ run: jest.fn(() => new Promise<void>((res) => (finish = res))) });
  await expect(backgroundRecordWith('push', d)).resolves.toBe('timeout');
  expect(d.leave).not.toHaveBeenCalled(); // 늦게 끝난 실행이 앞 화면처럼 백업하지 않게
  finish();
  await new Promise((r) => setTimeout(r, 0));
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

import { startForegroundInterval } from '@/features/game/lib/foreground-interval';

import { createSilentRunner, MARKET_REFRESH_MS, shouldRefreshNow } from './auto-refresh';

/** 프로미스 연쇄(then·catch·finally)가 끝날 때까지 마이크로태스크를 흘려보낸다 */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('createSilentRunner', () => {
  it('앞 실행이 끝나기 전 호출은 건너뛴다', async () => {
    let finish: () => void = () => undefined;
    const run = jest.fn(() => new Promise<void>((r) => { finish = r; }));
    const tick = createSilentRunner(run);
    tick();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('실패해도 던지지 않고(토스트 없음) 다음 호출은 다시 실행한다', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValue(undefined);
    const tick = createSilentRunner(run);
    tick();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('동기 예외도 삼킨다', async () => {
    const run = jest.fn((): Promise<unknown> => {
      throw new Error('boom');
    });
    const tick = createSilentRunner(run);
    expect(() => tick()).not.toThrow();
    await flush();
    tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('30초 자동 새로고침(포그라운드 주기 + 조용한 실행기)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('앱이 앞에 있을 때만 30초마다 부르고, 정지(화면 이탈) 뒤에는 부르지 않는다', async () => {
    let state = 'active';
    const run = jest.fn(() => Promise.resolve());
    const stop = startForegroundInterval(createSilentRunner(run), MARKET_REFRESH_MS, () => state);
    jest.advanceTimersByTime(MARKET_REFRESH_MS - 1);
    await flush();
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    state = 'background';
    jest.advanceTimersByTime(MARKET_REFRESH_MS * 3);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    state = 'active';
    stop(); // useFocusEffect 정리 = 다른 탭·상세 화면으로 이동
    jest.advanceTimersByTime(MARKET_REFRESH_MS * 3);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(MARKET_REFRESH_MS).toBe(30_000);
  });
});

describe('shouldRefreshNow', () => {
  it('한 번도 안 돌았으면 즉시', () => {
    expect(shouldRefreshNow(null, 1000)).toBe(true);
  });
  it('주기가 지나기 전에는 건너뛴다(탭을 빠르게 오갈 때 중복 방지)', () => {
    expect(shouldRefreshNow(1000, 1000 + MARKET_REFRESH_MS - 1)).toBe(false);
  });
  it('주기 이상 지났으면 즉시', () => {
    expect(shouldRefreshNow(1000, 1000 + MARKET_REFRESH_MS)).toBe(true);
  });
  it('시계가 거꾸로 가면 즉시', () => {
    expect(shouldRefreshNow(5000, 1000)).toBe(true);
  });
});

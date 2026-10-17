import { startForegroundInterval } from './foreground-interval';

describe('startForegroundInterval', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('포그라운드일 때만 주기마다 호출, 정지하면 멈춘다', () => {
    let state = 'active';
    const cb = jest.fn();
    const stop = startForegroundInterval(cb, 1000, () => state);
    jest.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    state = 'background';
    jest.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(1);
    state = 'active';
    jest.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(2);
    stop();
    jest.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

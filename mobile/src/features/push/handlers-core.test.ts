import { createResponseClaimer, handleNotificationResponseWith, isFundNotification } from './handlers-core';

describe('isFundNotification', () => {
  it('data.type 이 fund_report 일 때만 true', () => {
    expect(isFundNotification({ type: 'fund_report', date: '2026-10-21' })).toBe(true);
    expect(isFundNotification({ type: 'new_post' })).toBe(false);
    expect(isFundNotification(undefined)).toBe(false);
  });
});

describe('handleNotificationResponseWith', () => {
  it('펀드 알림 탭 → 펀드 화면 이동 + 강제 갱신', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'fund_report' }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/fund');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('다른 알림은 무시', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post' }, deps)).toBe(false);
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});

describe('createResponseClaimer', () => {
  it('동시에 같은 응답이 와도 한 번만 처리한다(저장소는 한 번만 읽음)', async () => {
    const load = jest.fn(async () => null as string | null);
    const save = jest.fn();
    const claim = createResponseClaimer(load, save);
    const results = await Promise.all([claim('a'), claim('a')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('저장된 id 와 같으면 거부, 새 id 면 허용', async () => {
    const claim = createResponseClaimer(async () => 'old', jest.fn());
    await expect(claim('old')).resolves.toBe(false);
    await expect(claim('new')).resolves.toBe(true);
    await expect(claim('new')).resolves.toBe(false);
  });

  it('저장소 읽기 실패는 미처리로 간주', async () => {
    const claim = createResponseClaimer(() => Promise.reject(new Error('x')), jest.fn());
    await expect(claim('a')).resolves.toBe(true);
  });
});

import { handleNotificationResponseWith, isFundNotification } from './handlers-core';

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

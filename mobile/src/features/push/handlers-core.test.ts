import {
  createResponseClaimer,
  handleNotificationResponseWith,
  isFundNotification,
  newPostIdOf,
  shouldShowForegroundBanner,
} from './handlers-core';

describe('isFundNotification', () => {
  it('data.type 이 fund_report 일 때만 true', () => {
    expect(isFundNotification({ type: 'fund_report', date: '2026-10-21' })).toBe(true);
    expect(isFundNotification({ type: 'new_post' })).toBe(false);
    expect(isFundNotification(undefined)).toBe(false);
  });
});

describe('newPostIdOf', () => {
  it('new_post 의 양의 정수 post_id(숫자 문자열 허용)만', () => {
    expect(newPostIdOf({ type: 'new_post', post_id: 12, board_id: 3 })).toBe(12);
    expect(newPostIdOf({ type: 'new_post', post_id: '34' })).toBe(34);
  });
  it('그 밖은 null', () => {
    expect(newPostIdOf({ type: 'new_post' })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: 0 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: -1 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: 1.5 })).toBeNull();
    expect(newPostIdOf({ type: 'new_post', post_id: '12abc' })).toBeNull();
    expect(newPostIdOf({ type: 'fund_report', post_id: 12 })).toBeNull();
    expect(newPostIdOf(null)).toBeNull();
  });
});

describe('handleNotificationResponseWith', () => {
  it('펀드 알림 탭 → 펀드 화면 이동 + 강제 갱신', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'fund_report' }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/fund');
    expect(deps.refresh).toHaveBeenCalledTimes(1);
  });

  it('새 글 알림 탭 → 글 상세로 이동(갱신 없음)', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post', post_id: 7, board_id: 1 }, deps)).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('/blog/7');
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it('글 id 가 없는 새 글 알림·모르는 알림은 무시', () => {
    const deps = { navigate: jest.fn(), refresh: jest.fn() };
    expect(handleNotificationResponseWith({ type: 'new_post' }, deps)).toBe(false);
    expect(handleNotificationResponseWith({ type: 'fund_refresh' }, deps)).toBe(false);
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});

describe('shouldShowForegroundBanner', () => {
  it('새 글은 앱이 앞에 있어도 배너(앱엔 새 글 SSE 토스트가 없음)', () => {
    expect(shouldShowForegroundBanner({ type: 'new_post', post_id: 1 })).toBe(true);
  });
  it('펀드 리포트·무음 깨우기·모르는 알림은 배너 없음', () => {
    expect(shouldShowForegroundBanner({ type: 'fund_report' })).toBe(false);
    expect(shouldShowForegroundBanner({ type: 'fund_refresh' })).toBe(false);
    expect(shouldShowForegroundBanner(undefined)).toBe(false);
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

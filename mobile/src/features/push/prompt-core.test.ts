import {
  effectivePermission,
  postNoticeEnableAction,
  postNoticeSwitchValue,
  shouldOfferPrompt,
  shouldPromptOnEnter,
  shouldPromptOnHome,
} from './prompt-core';

describe('effectivePermission', () => {
  it('Android 13+ 미요청(denied + canAskAgain)은 undetermined 로 본다', () => {
    expect(effectivePermission({ status: 'denied', canAskAgain: true })).toBe('undetermined');
  });
  it('다시 물을 수 없는 거부만 denied', () => {
    expect(effectivePermission({ status: 'denied', canAskAgain: false })).toBe('denied');
  });
  it('granted·undetermined 는 그대로', () => {
    expect(effectivePermission({ status: 'granted', canAskAgain: true })).toBe('granted');
    expect(effectivePermission({ status: 'undetermined', canAskAgain: true })).toBe('undetermined');
  });
});

describe('shouldOfferPrompt', () => {
  it('설정됨 + 아직 안 물어봄 + 첫 펀드(0→1)일 때만', () => {
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: false })).toBe(true);
    expect(shouldOfferPrompt({ prevCount: 1, nextCount: 2, configured: true, prompted: false })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: true, prompted: true })).toBe(false);
    expect(shouldOfferPrompt({ prevCount: 0, nextCount: 1, configured: false, prompted: false })).toBe(false);
  });
});

describe('shouldPromptOnEnter', () => {
  const base = { fundCount: 1, prompted: false, permission: 'undetermined', configured: true };
  it('정상: 펀드 있음 + 미질문 + 권한 미결정 + 설정됨이면 true', () => {
    expect(shouldPromptOnEnter(base)).toBe(true);
    expect(shouldPromptOnEnter({ ...base, fundCount: 3 })).toBe(true);
  });
  it('펀드 0개면 false', () => {
    expect(shouldPromptOnEnter({ ...base, fundCount: 0 })).toBe(false);
  });
  it('이미 물어봤으면 false', () => {
    expect(shouldPromptOnEnter({ ...base, prompted: true })).toBe(false);
  });
  it('권한이 granted 또는 denied면 false', () => {
    expect(shouldPromptOnEnter({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldPromptOnEnter({ ...base, permission: 'denied' })).toBe(false);
  });
  it('푸시 미설정이면 false', () => {
    expect(shouldPromptOnEnter({ ...base, configured: false })).toBe(false);
  });
});

describe('postNoticeSwitchValue', () => {
  it('저장값이 켜짐이고 권한이 허용일 때만 켜짐으로 보인다', () => {
    expect(postNoticeSwitchValue(true, 'granted')).toBe(true);
    expect(postNoticeSwitchValue(true, 'undetermined')).toBe(false);
    expect(postNoticeSwitchValue(true, 'denied')).toBe(false);
    expect(postNoticeSwitchValue(false, 'granted')).toBe(false);
  });
});

describe('postNoticeEnableAction', () => {
  it('권한 허용이면 저장만', () => {
    expect(postNoticeEnableAction('granted')).toBe('none');
  });
  it('권한 미결정이면 OS 권한 요청', () => {
    expect(postNoticeEnableAction('undetermined')).toBe('request');
  });
  it('다시 물을 수 없는 거부면 설정 앱 안내', () => {
    expect(postNoticeEnableAction('denied')).toBe('open-settings');
  });
});

describe('shouldPromptOnHome', () => {
  const base = { loggedIn: true, prompted: false, permission: 'undetermined', configured: true };
  it('로그인 + 미질문 + 권한 미결정 + 설정됨이면 true(펀드 없어도)', () => {
    expect(shouldPromptOnHome(base)).toBe(true);
  });
  it('비로그인이면 false', () => {
    expect(shouldPromptOnHome({ ...base, loggedIn: false })).toBe(false);
  });
  it('이미 물어봤으면 false(펀드 경로와 기록 공유)', () => {
    expect(shouldPromptOnHome({ ...base, prompted: true })).toBe(false);
  });
  it('권한이 이미 결정됐으면 false', () => {
    expect(shouldPromptOnHome({ ...base, permission: 'granted' })).toBe(false);
    expect(shouldPromptOnHome({ ...base, permission: 'denied' })).toBe(false);
  });
  it('푸시 미설정이면 false', () => {
    expect(shouldPromptOnHome({ ...base, configured: false })).toBe(false);
  });
});

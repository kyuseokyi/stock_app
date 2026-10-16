import { reasonFromBody, sessionEndMessage, shouldValidate, VALIDATE_INTERVAL_MS } from './session-end';

describe('reasonFromBody', () => {
  test('detail.code SESSION_REPLACED → replaced', () => {
    expect(reasonFromBody({ detail: { code: 'SESSION_REPLACED', message: 'x' } })).toBe('replaced');
  });
  test('그 외(문자열 detail·빈 본문) → expired', () => {
    expect(reasonFromBody({ detail: '유효하지 않은 토큰입니다.' })).toBe('expired');
    expect(reasonFromBody(undefined)).toBe('expired');
    expect(reasonFromBody('text')).toBe('expired');
  });
});

describe('sessionEndMessage', () => {
  test('사유별 문구', () => {
    expect(sessionEndMessage('replaced')).toBe('다른 기기에서 로그인되어 로그아웃됐어요');
    expect(sessionEndMessage('expired')).toBe('로그인이 만료되었어요. 다시 로그인해 주세요');
  });
});

describe('shouldValidate', () => {
  test('force 면 항상', () => {
    expect(shouldValidate(1_000, 1_001, true)).toBe(true);
  });
  test('60초 이내면 생략, 지나면 확인', () => {
    expect(shouldValidate(0, VALIDATE_INTERVAL_MS - 1, false)).toBe(false);
    expect(shouldValidate(0, VALIDATE_INTERVAL_MS, false)).toBe(true);
  });
});

import {
  codeFromBody,
  isRefreshable401,
  reasonFromBody,
  reasonFromCode,
  sessionEndMessage,
  shouldValidate,
  VALIDATE_INTERVAL_MS,
} from './session-end';

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
    expect(sessionEndMessage('ended')).toBe('로그아웃됐어요. 다시 로그인해 주세요');
    expect(sessionEndMessage('reused')).toBe('보안을 위해 로그아웃됐어요. 다시 로그인해 주세요');
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

describe('codeFromBody·isRefreshable401(리프레시 토큰 401 사유 코드)', () => {
  test('dict detail 의 code 추출, 문자열 detail·빈 본문은 null', () => {
    expect(codeFromBody({ detail: { code: 'TOKEN_EXPIRED', message: 'x' } })).toBe('TOKEN_EXPIRED');
    expect(codeFromBody({ detail: '유효하지 않은 토큰입니다.' })).toBeNull();
    expect(codeFromBody(undefined)).toBeNull();
  });
  test('만료·사유 없음만 갱신 대상, 교체·무효는 아님', () => {
    expect(isRefreshable401({ detail: { code: 'TOKEN_EXPIRED' } })).toBe(true);
    expect(isRefreshable401({ detail: '구 서버' })).toBe(true);
    expect(isRefreshable401({ detail: { code: 'SESSION_REPLACED' } })).toBe(false);
    expect(isRefreshable401({ detail: { code: 'TOKEN_INVALID' } })).toBe(false);
  });
  test('사유 코드별 분류 — 종료·재사용 감지는 별도 안내, 나머지는 만료', () => {
    expect(reasonFromBody({ detail: { code: 'TOKEN_EXPIRED' } })).toBe('expired');
    expect(reasonFromBody({ detail: { code: 'TOKEN_INVALID' } })).toBe('expired');
    expect(reasonFromBody({ detail: { code: 'REFRESH_INVALID' } })).toBe('expired');
    expect(reasonFromBody({ detail: { code: 'SESSION_ENDED' } })).toBe('ended');
    expect(reasonFromBody({ detail: { code: 'REFRESH_REUSED' } })).toBe('reused');
  });
  test('SESSION_ENDED 는 갱신 대상 아님', () => {
    expect(isRefreshable401({ detail: { code: 'SESSION_ENDED' } })).toBe(false);
  });
  test('reasonFromCode — WS close reason 도 같은 규칙, 빈 값·모르는 값은 expired', () => {
    expect(reasonFromCode('SESSION_REPLACED')).toBe('replaced');
    expect(reasonFromCode('SESSION_ENDED')).toBe('ended');
    expect(reasonFromCode('REFRESH_REUSED')).toBe('reused');
    expect(reasonFromCode('TOKEN_INVALID')).toBe('expired');
    expect(reasonFromCode('')).toBe('expired');
    expect(reasonFromCode(null)).toBe('expired');
    expect(reasonFromCode(undefined)).toBe('expired');
  });
});

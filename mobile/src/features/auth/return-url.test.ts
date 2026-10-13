import { isAuthReturnUrl, parseAuthReturnUrl, socialErrorMessage } from './return-url';

describe('parseAuthReturnUrl', () => {
  test('code', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=abc123')).toEqual({ type: 'code', code: 'abc123' });
  });
  test('dev 스킴 + URL 인코딩 해제', () => {
    expect(parseAuthReturnUrl('stockapp-dev://auth?code=a%2Bb%3D')).toEqual({ type: 'code', code: 'a+b=' });
  });
  test('error', () => {
    expect(parseAuthReturnUrl('stockapp://auth?error=cancelled')).toEqual({ type: 'error', error: 'cancelled' });
  });
  test('error 가 code 보다 우선', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=x&error=inactive')).toEqual({ type: 'error', error: 'inactive' });
  });
  test('해시 무시·첫 값 사용', () => {
    expect(parseAuthReturnUrl('stockapp://auth?code=first&code=second#frag')).toEqual({ type: 'code', code: 'first' });
  });
  test('쿼리 없음·빈 값·깨진 인코딩은 null', () => {
    expect(parseAuthReturnUrl('stockapp://auth')).toBeNull();
    expect(parseAuthReturnUrl('stockapp://auth?code=')).toBeNull();
    expect(parseAuthReturnUrl('stockapp://auth?code=%E0%A4%A')).toBeNull();
  });
});

describe('isAuthReturnUrl', () => {
  test('복귀 딥링크', () => {
    expect(isAuthReturnUrl('stockapp://auth?code=x')).toBe(true);
    expect(isAuthReturnUrl('stockapp-dev://auth?error=cancelled')).toBe(true);
    expect(isAuthReturnUrl('stockapp-dev://auth')).toBe(true);
    expect(isAuthReturnUrl('/auth?code=x')).toBe(true);
  });
  test('다른 경로', () => {
    expect(isAuthReturnUrl('stockapp://blog/1')).toBe(false);
    expect(isAuthReturnUrl('stockapp://authors')).toBe(false);
    expect(isAuthReturnUrl('/profile')).toBe(false);
  });
});

describe('socialErrorMessage', () => {
  test('알려진 코드와 기본 문구', () => {
    expect(socialErrorMessage('inactive')).toContain('제한');
    expect(socialErrorMessage('unknown')).toBe('로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
  });
});

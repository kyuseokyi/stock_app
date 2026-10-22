import { detectEnvMismatch } from './env-guard';

describe('detectEnvMismatch', () => {
  it('개발 앱에 운영 env 가 실리면 감지', () => {
    expect(detectEnvMismatch('com.stockapp.dev', 'production')).toEqual({
      packageId: 'com.stockapp.dev',
      expected: 'development',
      bundled: 'production',
    });
  });
  it('운영 앱에 개발 env 가 실리면 감지', () => {
    expect(detectEnvMismatch('com.stockapp', 'development')?.expected).toBe('production');
  });
  it('일치하면 null', () => {
    expect(detectEnvMismatch('com.stockapp.dev', 'development')).toBeNull();
    expect(detectEnvMismatch('com.stockapp', 'production')).toBeNull();
  });
  it('패키지를 모르거나(웹·테스트) Expo Go 면 판정하지 않음', () => {
    expect(detectEnvMismatch(null, 'production')).toBeNull();
    expect(detectEnvMismatch(undefined, 'development')).toBeNull();
    expect(detectEnvMismatch('host.exp.exponent', 'production')).toBeNull();
  });
});

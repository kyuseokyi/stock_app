import { FUNDS_TAB_PATH } from './fund-gate';
import {
  clearLoginReturn,
  hasLoginReturn,
  isAllowedReturnPath,
  LOGIN_RETURN_TTL_MS,
  rememberLoginReturn,
  takeLoginReturn,
} from './login-return';

describe('로그인 후 돌아갈 곳(login-return)', () => {
  afterEach(() => clearLoginReturn());

  it('기억이 없으면 null', () => {
    expect(takeLoginReturn()).toBeNull();
  });

  it('기억한 내 펀드 경로를 한 번만 돌려준다', () => {
    rememberLoginReturn(FUNDS_TAB_PATH, 1_000);
    expect(takeLoginReturn(2_000)).toBe('/funds');
    expect(takeLoginReturn(2_000)).toBeNull();
  });

  it('유효 시간이 지나면 무효(그리고 비워진다)', () => {
    rememberLoginReturn(FUNDS_TAB_PATH, 0);
    expect(takeLoginReturn(LOGIN_RETURN_TTL_MS + 1)).toBeNull();
    expect(takeLoginReturn(1)).toBeNull();
  });

  it('유효 시간 경계 안이면 유효', () => {
    rememberLoginReturn(FUNDS_TAB_PATH, 0);
    expect(takeLoginReturn(LOGIN_RETURN_TTL_MS)).toBe('/funds');
  });

  it('시계가 거꾸로 가면(기억 시각보다 이전) 무효', () => {
    rememberLoginReturn(FUNDS_TAB_PATH, 5_000);
    expect(takeLoginReturn(4_000)).toBeNull();
  });

  it('취소(clear)하면 이동하지 않는다', () => {
    rememberLoginReturn(FUNDS_TAB_PATH);
    clearLoginReturn();
    expect(takeLoginReturn()).toBeNull();
  });

  it('허용 목록 밖 경로는 기억하지 않고 이전 기억도 비운다', () => {
    rememberLoginReturn('/community');
    expect(takeLoginReturn()).toBeNull();
    rememberLoginReturn(FUNDS_TAB_PATH);
    rememberLoginReturn('//evil.example');
    expect(takeLoginReturn()).toBeNull();
  });

  it('허용 경로 판정 — 내 펀드 탭만', () => {
    expect(isAllowedReturnPath('/funds')).toBe(true);
    expect(isAllowedReturnPath('/fund')).toBe(false);
    expect(isAllowedReturnPath('/profile')).toBe(false);
    expect(isAllowedReturnPath('')).toBe(false);
    expect(isAllowedReturnPath(null)).toBe(false);
  });

  it('들여다보기(hasLoginReturn)는 비우지 않고, 만료·취소면 false', () => {
    expect(hasLoginReturn(0)).toBe(false);
    rememberLoginReturn(FUNDS_TAB_PATH, 1_000);
    expect(hasLoginReturn(2_000)).toBe(true);
    expect(hasLoginReturn(1_000 + LOGIN_RETURN_TTL_MS + 1)).toBe(false);
    expect(takeLoginReturn(2_000)).toBe('/funds');
    expect(hasLoginReturn(2_000)).toBe(false);
    rememberLoginReturn(FUNDS_TAB_PATH, 1_000);
    clearLoginReturn();
    expect(hasLoginReturn(2_000)).toBe(false);
  });
});

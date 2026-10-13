import { ApiError } from '@/lib/api/http';

import { apiErrorCode, gameErrorMessage, orderErrorMessage } from './errors';

const api = (status: number, body?: unknown) => new ApiError(status, `HTTP ${status}`, body);

describe('gameErrorMessage', () => {
  test('ApiError 아님(fetch TypeError 등) → 네트워크 문구', () => {
    expect(gameErrorMessage(new TypeError('Network request failed'))).toBe('게임 서버에 연결할 수 없어요');
  });
  test('401 → 로그인 만료', () => {
    expect(gameErrorMessage(api(401, { detail: 'x' }))).toBe('로그인이 만료되었어요. 다시 로그인해 주세요');
  });
  test('객체 detail code 고정 문구', () => {
    expect(gameErrorMessage(api(404, { detail: { code: 'NO_QUIZ_AVAILABLE', message: 'm' } }))).toBe(
      '준비된 문제를 모두 풀었어요',
    );
    expect(gameErrorMessage(api(503, { detail: { code: 'FEATURE_DISABLED', message: 'm' } }))).toBe(
      '지금은 운영하지 않는 기능이에요',
    );
    expect(gameErrorMessage(api(403, { detail: { code: 'LEVERAGE_LOCKED', message: 'm' } }))).toBe(
      '5배 레버리지는 아카데미 퀴즈를 통과해야 쓸 수 있어요',
    );
  });
  test('모르는 code → message', () => {
    expect(gameErrorMessage(api(400, { detail: { code: 'NEW_CODE', message: '새 오류' } }))).toBe('새 오류');
  });
  test('문자열 detail(403/404/409/422) → 그대로', () => {
    expect(gameErrorMessage(api(409, { detail: '이미 보유 중인 포지션이 있습니다' }))).toBe(
      '이미 보유 중인 포지션이 있습니다',
    );
  });
  test('그 외 상태·본문 없음 → 네트워크 문구', () => {
    expect(gameErrorMessage(api(500, 'Internal Server Error'))).toBe('게임 서버에 연결할 수 없어요');
    expect(gameErrorMessage(api(400, { detail: '문자열' }))).toBe('게임 서버에 연결할 수 없어요');
  });
});

describe('apiErrorCode', () => {
  test('객체 detail 의 code 만', () => {
    expect(apiErrorCode(api(503, { detail: { code: 'FEATURE_DISABLED' } }))).toBe('FEATURE_DISABLED');
    expect(apiErrorCode(api(409, { detail: '문자열' }))).toBeNull();
    expect(apiErrorCode(new Error('x'))).toBeNull();
  });
});

describe('orderErrorMessage', () => {
  test('422 배열 detail(검증 오류) → 주문 조건 문구', () => {
    expect(orderErrorMessage(api(422, { detail: [{ loc: ['body', 'ratio'], msg: 'bad' }] }))).toBe(
      '주문 조건이 올바르지 않아요',
    );
  });
  test('422 문자열 detail → 그대로', () => {
    expect(orderErrorMessage(api(422, { detail: '거래 가능 시간이 아닙니다' }))).toBe('거래 가능 시간이 아닙니다');
  });
  test('나머지는 gameErrorMessage 와 동일', () => {
    expect(orderErrorMessage(api(409, { detail: '이미 보유 중' }))).toBe('이미 보유 중');
    expect(orderErrorMessage(new TypeError('x'))).toBe('게임 서버에 연결할 수 없어요');
  });
});

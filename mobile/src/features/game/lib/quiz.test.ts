import { isQuizPrimeTime, quizSecondsLeft, volumeHeights } from './quiz';

describe('isQuizPrimeTime (KST)', () => {
  test('평일 15:29 → false, 15:30 → true', () => {
    // 2026-10-13(화) KST 15:29 = UTC 06:29
    expect(isQuizPrimeTime(new Date('2026-10-13T06:29:00Z'))).toBe(false);
    expect(isQuizPrimeTime(new Date('2026-10-13T06:30:00Z'))).toBe(true);
  });
  test('평일 23:59 → true, 다음 날 00:00(평일) → false', () => {
    expect(isQuizPrimeTime(new Date('2026-10-13T14:59:00Z'))).toBe(true);
    expect(isQuizPrimeTime(new Date('2026-10-13T15:00:00Z'))).toBe(false); // KST 10-14(수) 00:00
  });
  test('토/일 종일 → true', () => {
    expect(isQuizPrimeTime(new Date('2026-10-17T01:00:00Z'))).toBe(true); // KST 토 10:00
    expect(isQuizPrimeTime(new Date('2026-10-18T01:00:00Z'))).toBe(true); // KST 일 10:00
  });
});

describe('quizSecondsLeft', () => {
  test('시작 순간 = limit, 정확히 limit 경과 = 0', () => {
    expect(quizSecondsLeft(1000, 10, 1000)).toBe(10);
    expect(quizSecondsLeft(1000, 10, 11000)).toBe(0);
  });
  test('올림 — 0.1초 남으면 1', () => {
    expect(quizSecondsLeft(0, 10, 9900)).toBe(1);
    expect(quizSecondsLeft(0, 10, 200)).toBe(10);
  });
  test('초과는 0', () => {
    expect(quizSecondsLeft(0, 10, 99999)).toBe(0);
  });
});

describe('volumeHeights', () => {
  test('최대 거래량 = 최대 높이, 결측은 0', () => {
    expect(volumeHeights([50, 100, undefined, 25], 40)).toEqual([20, 40, 0, 10]);
  });
  test('거래량이 전부 없거나 0 이면 모두 0', () => {
    expect(volumeHeights([undefined, 0], 40)).toEqual([0, 0]);
    expect(volumeHeights([], 40)).toEqual([]);
  });
});

import {
  applyTickIntraday,
  axisLabelIndexes,
  bucketStartSec,
  dayLabel,
  isChartInterval,
  kstHm,
  mergeTickIntraday,
  normalizeIntradayCandles,
} from './intraday';
import type { IntradayCandle } from '../types';

// 2026-10-14 09:07:30 KST = 2026-10-14 00:07:30 UTC
const NOW_MS = Date.UTC(2026, 9, 14, 0, 7, 30);
const sec = (h: number, m: number) => Date.UTC(2026, 9, 14, h, m, 0) / 1000; // UTC 시각 → epoch s

const c = (t: number, o: number, h: number, l: number, cl: number, v = 0): IntradayCandle => ({
  t,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: v,
});

describe('bucketStartSec', () => {
  test('1분 — 09:07:00 KST', () => {
    expect(bucketStartSec(NOW_MS, '1m')).toBe(sec(0, 7));
  });
  test('5분 — 09:05 KST', () => {
    expect(bucketStartSec(NOW_MS, '5m')).toBe(sec(0, 5));
  });
  test('15분 — 09:00 KST', () => {
    expect(bucketStartSec(NOW_MS, '15m')).toBe(sec(0, 0));
  });
  test('60분 — KST 정시(09:00 KST = 00:00 UTC)', () => {
    expect(bucketStartSec(NOW_MS, '60m')).toBe(sec(0, 0));
    expect(kstHm(bucketStartSec(Date.UTC(2026, 9, 14, 6, 59, 59), '60m'))).toBe('15:00');
  });
  test('경계 정각은 그 버킷의 시작', () => {
    expect(bucketStartSec(Date.UTC(2026, 9, 14, 0, 10, 0), '5m')).toBe(sec(0, 10));
  });
});

describe('mergeTickIntraday', () => {
  test('마지막 캔들 없음 → 새 버킷(OHLC=price, volume 0)', () => {
    expect(mergeTickIntraday(null, sec(0, 5), 100)).toEqual(c(sec(0, 5), 100, 100, 100, 100));
  });
  test('같은 버킷 → 고저 갱신·종가 교체, 시가·거래량 유지', () => {
    const last = c(sec(0, 5), 100, 105, 98, 101, 500);
    expect(mergeTickIntraday(last, sec(0, 5), 110)).toEqual(c(sec(0, 5), 100, 110, 98, 110, 500));
    expect(mergeTickIntraday(last, sec(0, 5), 90)).toEqual(c(sec(0, 5), 100, 105, 90, 90, 500));
  });
  test('새 버킷 → 새 캔들', () => {
    const last = c(sec(0, 0), 100, 105, 98, 101, 500);
    expect(mergeTickIntraday(last, sec(0, 5), 102)).toEqual(c(sec(0, 5), 102, 102, 102, 102));
  });
  test('last 가 더 최신(시계 오차) → last 에 병합', () => {
    const last = c(sec(0, 10), 100, 100, 100, 100);
    expect(mergeTickIntraday(last, sec(0, 5), 101).t).toBe(sec(0, 10));
  });
  test('원본 불변', () => {
    const last = c(sec(0, 5), 100, 100, 100, 100);
    mergeTickIntraday(last, sec(0, 5), 120);
    expect(last.close).toBe(100);
  });
});

describe('applyTickIntraday', () => {
  test('같은 버킷이면 마지막 교체, 새 버킷이면 추가', () => {
    const rows = [c(sec(0, 0), 1, 1, 1, 1), c(sec(0, 5), 2, 2, 2, 2)];
    expect(applyTickIntraday(rows, sec(0, 5), 3)).toHaveLength(2);
    const added = applyTickIntraday(rows, sec(0, 10), 3);
    expect(added).toHaveLength(3);
    expect(added[2]).toEqual(c(sec(0, 10), 3, 3, 3, 3));
  });
  test('빈 배열 → 1개', () => {
    expect(applyTickIntraday([], sec(0, 5), 7)).toEqual([c(sec(0, 5), 7, 7, 7, 7)]);
  });
});

describe('normalizeIntradayCandles', () => {
  test('정상 응답 + 숫자 문자열 허용, t 오름차순', () => {
    const raw = {
      interval: '5m',
      ticker: '005930',
      candles: [
        {
          t: 200,
          open: '1',
          high: '2',
          low: '0.5',
          close: '1.5',
          volume: '10',
        },
        { t: 100, open: 1, high: 1, low: 1, close: 1, volume: 3 },
      ],
    };
    expect(normalizeIntradayCandles(raw)).toEqual([c(100, 1, 1, 1, 1, 3), c(200, 1, 2, 0.5, 1.5, 10)]);
  });
  test('깨진 행은 버리고 volume 없으면 0', () => {
    const raw = {
      candles: [{ t: 1, open: 1, high: 1, low: 1 }, { t: 2, open: 1, high: 1, low: 1, close: 1 }, null],
    };
    expect(normalizeIntradayCandles(raw)).toEqual([c(2, 1, 1, 1, 1)]);
  });
  test('형식 아님 → []', () => {
    expect(normalizeIntradayCandles(null)).toEqual([]);
    expect(normalizeIntradayCandles({ candles: 'x' })).toEqual([]);
  });
});

describe('라벨', () => {
  test('kstHm — UTC 00:05 → 09:05, UTC 15:30 → 다음날 00:30', () => {
    expect(kstHm(sec(0, 5))).toBe('09:05');
    expect(kstHm(sec(15, 30))).toBe('00:30');
  });
  test('dayLabel', () => {
    expect(dayLabel('2026-10-14')).toBe('10/14');
  });
  test('axisLabelIndexes', () => {
    expect(axisLabelIndexes(0)).toEqual([]);
    expect(axisLabelIndexes(1)).toEqual([0]);
    expect(axisLabelIndexes(2)).toEqual([0, 1]);
    expect(axisLabelIndexes(60)).toEqual([0, 29, 59]);
  });
  test('isChartInterval', () => {
    expect(isChartInterval('5m')).toBe(true);
    expect(isChartInterval('day')).toBe(true);
    expect(isChartInterval('30m')).toBe(false);
  });
});

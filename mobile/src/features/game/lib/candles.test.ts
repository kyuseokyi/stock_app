import { applyTick, mergeTick } from './candles';
import type { DailyCandle } from '../types';

const c = (date: string, o: number, h: number, l: number, cl: number): DailyCandle => ({
  date,
  open: o,
  high: h,
  low: l,
  close: cl,
});

describe('mergeTick', () => {
  test('마지막 캔들 없음 → 오늘 캔들 신규(OHLC 모두 price)', () => {
    expect(mergeTick(null, '2026-10-13', 100)).toEqual(c('2026-10-13', 100, 100, 100, 100));
  });
  test('오늘 캔들에 병합 — 고가/저가 확장, 종가 갱신, 원본 불변', () => {
    const last = c('2026-10-13', 100, 105, 95, 101);
    expect(mergeTick(last, '2026-10-13', 110)).toEqual(c('2026-10-13', 100, 110, 95, 110));
    expect(mergeTick(last, '2026-10-13', 90)).toEqual(c('2026-10-13', 100, 105, 90, 90));
    expect(last).toEqual(c('2026-10-13', 100, 105, 95, 101));
  });
  test('마지막 캔들이 과거 → 오늘 캔들 신규', () => {
    expect(mergeTick(c('2026-10-12', 1, 2, 1, 2), '2026-10-13', 50)).toEqual(c('2026-10-13', 50, 50, 50, 50));
  });
  test('시계 오차로 마지막 캔들이 더 최신 → 그 캔들에 병합(날짜 유지)', () => {
    expect(mergeTick(c('2026-10-14', 100, 100, 100, 100), '2026-10-13', 120)).toEqual(
      c('2026-10-14', 100, 120, 100, 120),
    );
  });
});

describe('applyTick', () => {
  test('빈 배열 → 오늘 캔들 1개', () => {
    expect(applyTick([], '2026-10-13', 100)).toEqual([c('2026-10-13', 100, 100, 100, 100)]);
  });
  test('같은 날 → 마지막 교체(길이 유지, 원본 불변)', () => {
    const src = [c('2026-10-12', 1, 1, 1, 1), c('2026-10-13', 100, 100, 100, 100)];
    const out = applyTick(src, '2026-10-13', 120);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(c('2026-10-13', 100, 120, 100, 120));
    expect(src[1].close).toBe(100);
  });
  test('새 날 → 뒤에 추가', () => {
    const out = applyTick([c('2026-10-12', 1, 1, 1, 1)], '2026-10-13', 7);
    expect(out.map((x) => x.date)).toEqual(['2026-10-12', '2026-10-13']);
  });
});

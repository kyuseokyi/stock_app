import { TREND_LOOKBACK, TREND_PIVOT, trendLines, valueAt } from './trend-lines';

// high 배열로 봉 만들기(low 는 high - 1)
const barsOf = (highs: number[], lows?: number[]) =>
  highs.map((h, i) => ({ high: h, low: lows ? lows[i] : h - 1 }));

describe('trendLines', () => {
  test('상수', () => {
    expect(TREND_PIVOT).toBe(3);
    expect(TREND_LOOKBACK).toBe(120);
  });

  test('스윙 고점 2개를 잇는 저항선', () => {
    //            0  1  2  3   4  5  6  7   8  9 10 11 12 13 14 15
    const highs = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1, 1, 1];
    const { resistance } = trendLines(barsOf(highs), { pivot: 3 });
    expect(resistance).toEqual({ i1: 3, p1: 10, i2: 9, p2: 12 });
  });

  test('스윙 저점 2개를 잇는 지지선', () => {
    const lows = [9, 8, 7, 1, 7, 8, 9, 8, 7, 2, 7, 8, 9, 9, 9, 9];
    const { support } = trendLines(barsOf(lows.map((l) => l + 1), lows), { pivot: 3 });
    expect(support).toEqual({ i1: 3, p1: 1, i2: 9, p2: 2 });
  });

  test('오른쪽 pivot 개가 없는 최근 캔들은 제외', () => {
    const highs = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2]; // 9번은 오른쪽 2개뿐
    expect(trendLines(barsOf(highs), { pivot: 3 }).resistance).toBeNull();
  });

  test('같은 값이 이어지면 나중 것', () => {
    const highs = [1, 2, 3, 10, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1];
    const { resistance } = trendLines(barsOf(highs), { pivot: 3 });
    expect(resistance).toEqual({ i1: 4, p1: 10, i2: 10, p2: 12 });
  });

  test('가장 최근 2개 선택', () => {
    const highs = [1, 2, 3, 20, 3, 2, 1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1];
    const { resistance } = trendLines(barsOf(highs), { pivot: 3 });
    expect(resistance).toEqual({ i1: 9, p1: 10, i2: 15, p2: 12 });
  });

  test('2개 미만이면 null', () => {
    const highs = [1, 2, 3, 10, 3, 2, 1, 1, 1, 1];
    const r = trendLines(barsOf(highs), { pivot: 3 });
    expect(r.resistance).toBeNull();
    expect(trendLines([], { pivot: 3 })).toEqual({ resistance: null, support: null });
  });

  test('lookback 밖은 무시하되 i 는 전체 bars 기준', () => {
    const highs = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1, 1, 1];
    const long = [...Array(20).fill(1), ...highs]; // 길이 36, 고점은 23·29
    // lookback 15 → 시작 21: 23번은 왼쪽 pivot 이 범위 밖이라 후보 아님
    expect(trendLines(barsOf(long), { pivot: 3, lookback: 15 }).resistance).toBeNull();
    expect(trendLines(barsOf(long), { pivot: 3, lookback: 16 }).resistance).toEqual({ i1: 23, p1: 10, i2: 29, p2: 12 });
    expect(trendLines(barsOf(long)).resistance).toEqual({ i1: 23, p1: 10, i2: 29, p2: 12 });
  });
});

describe('valueAt', () => {
  test('연장 계산', () => {
    const line = { i1: 2, p1: 100, i2: 6, p2: 120 };
    expect(valueAt(line, 2)).toBe(100);
    expect(valueAt(line, 6)).toBe(120);
    expect(valueAt(line, 10)).toBe(140);
    expect(valueAt(line, 0)).toBe(90);
  });
});

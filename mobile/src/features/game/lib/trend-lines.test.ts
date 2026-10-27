import { horizontalLevels, TREND_LOOKBACK, TREND_PIVOT } from './trend-lines';

// high 배열로 봉 만들기(low 는 high - 1)
const barsOf = (highs: number[], lows?: number[]) =>
  highs.map((h, i) => ({ high: h, low: lows ? lows[i] : h - 1 }));

describe('horizontalLevels', () => {
  test('상수', () => {
    expect(TREND_PIVOT).toBe(3);
    expect(TREND_LOOKBACK).toBe(120);
  });

  // 스윙 고점: 3번(high 10)·9번(high 12) / 스윙 저점은 low = high-1 이라 같은 순번에서 아래쪽(low 9·11)은 고점 쪽이 아님
  const highs = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2, 1, 1, 1, 1];

  test('현재가 위에서 가장 낮은 후보 = 저항, 아래에서 가장 높은 후보 = 지지', () => {
    // 후보: 고점 10(i3)·12(i9), 저점 low=h-1 중 스윙 저점 6번(low 0)
    const r = horizontalLevels(barsOf(highs), 8, { pivot: 3 });
    expect(r.resistance).toEqual({ i: 3, price: 10 });
    expect(r.support).toEqual({ i: 6, price: 0 });
  });

  test('고점·저점을 섞음 — 돌파된 옛 고점이 지지가 된다', () => {
    const r = horizontalLevels(barsOf(highs), 13, { pivot: 3 });
    expect(r.support).toEqual({ i: 9, price: 12 });
    expect(r.resistance).toBeNull();
  });

  test('깨진 옛 저점은 저항이 된다', () => {
    const lows = [9, 8, 7, 5, 7, 8, 9, 9, 9, 9, 9, 9];
    const r = horizontalLevels(barsOf(lows.map((l) => l + 1), lows), 4, { pivot: 3 });
    expect(r.resistance).toEqual({ i: 3, price: 5 });
  });

  test('현재가와 같은 가격은 저항', () => {
    const r = horizontalLevels(barsOf(highs), 10, { pivot: 3 });
    expect(r.resistance).toEqual({ i: 3, price: 10 });
  });

  test('같은 가격이면 더 최근 것', () => {
    const h = [1, 2, 3, 10, 3, 2, 1, 2, 3, 10, 3, 2, 1, 1, 1, 1];
    expect(horizontalLevels(barsOf(h), 8, { pivot: 3 }).resistance).toEqual({ i: 9, price: 10 });
  });

  test('위나 아래에 후보가 없으면 null', () => {
    expect(horizontalLevels(barsOf(highs), 100, { pivot: 3 }).resistance).toBeNull();
    expect(horizontalLevels(barsOf(highs), -5, { pivot: 3 }).support).toBeNull();
    expect(horizontalLevels([], 10, { pivot: 3 })).toEqual({ resistance: null, support: null });
  });

  test('오른쪽 pivot 개가 없는 최근 캔들은 제외', () => {
    const h = [1, 2, 3, 10, 3, 2, 1, 2, 3, 12, 3, 2]; // 9번은 오른쪽 2개뿐
    expect(horizontalLevels(barsOf(h), 11, { pivot: 3 }).support).not.toEqual({ i: 9, price: 12 });
    expect(horizontalLevels(barsOf(h), 11, { pivot: 3 }).resistance).toBeNull();
  });

  test('lookback 밖은 무시하되 i 는 전체 bars 기준', () => {
    const long = [...Array(20).fill(1), ...highs]; // 길이 36, 고점은 23·29
    // lookback 15 → 시작 21: 23번은 왼쪽 pivot 이 범위 밖이라 후보 아님
    expect(horizontalLevels(barsOf(long), 8, { pivot: 3, lookback: 15 }).resistance).toEqual({ i: 29, price: 12 });
    expect(horizontalLevels(barsOf(long), 8, { pivot: 3, lookback: 16 }).resistance).toEqual({ i: 23, price: 10 });
    expect(horizontalLevels(barsOf(long), 8).resistance).toEqual({ i: 23, price: 10 });
  });
});

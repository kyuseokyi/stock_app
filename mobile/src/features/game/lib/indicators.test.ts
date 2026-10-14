import { bollinger, lineSegments, sma } from './indicators';

describe('sma', () => {
  it('기간보다 앞 구간은 null, 이후는 직전 period 개 평균', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('캔들이 기간보다 적으면 전부 null', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('빈 입력은 빈 배열', () => {
    expect(sma([], 5)).toEqual([]);
  });
});

describe('bollinger', () => {
  it('중심=SMA, 상·하단=중심 ± k×모표준편차', () => {
    // [2,4,4,4,5,5,7,9] 평균 5, 모표준편차 2
    const out = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(out.slice(0, 7).every((b) => b === null)).toBe(true);
    expect(out[7]).toEqual({ upper: 9, middle: 5, lower: 1 });
  });

  it('가격이 일정하면 밴드 폭 0', () => {
    const out = bollinger([10, 10, 10], 3, 2);
    expect(out[2]).toEqual({ upper: 10, middle: 10, lower: 10 });
  });

  it('기본값은 20, 2σ', () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = bollinger(values);
    expect(out[18]).toBeNull();
    expect(out[19]?.middle).toBeCloseTo(10.5);
  });
});

describe('lineSegments', () => {
  it('이웃한 두 점을 잇는 선분(중점 기준 배치 + 각도)', () => {
    const [s] = lineSegments([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]);
    expect(s.width).toBeCloseTo(5);
    expect(s.left).toBeCloseTo(1.5 - 2.5);
    expect(s.top).toBeCloseTo(2 - 0.5);
    expect(s.angleDeg).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI);
  });

  it('null 점 양옆은 잇지 않는다', () => {
    const segs = lineSegments([{ x: 0, y: 0 }, null, { x: 2, y: 0 }, { x: 4, y: 0 }]);
    expect(segs).toHaveLength(1);
    expect(segs[0].left).toBeCloseTo(2);
  });
});

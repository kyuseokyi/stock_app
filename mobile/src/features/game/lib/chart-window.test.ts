import { clampOffset, dragOffset, offsetAfterGrowth, windowRange } from './chart-window';

describe('차트 표시 구간(좌우 이동)', () => {
  it('offset 0 = 최신 VISIBLE 개', () => {
    expect(windowRange(100, 60, 0)).toEqual({ start: 40, end: 100 });
  });

  it('offset 만큼 과거로', () => {
    expect(windowRange(100, 60, 30)).toEqual({ start: 10, end: 70 });
  });

  it('범위를 넘는 offset 은 잘라서 계산', () => {
    expect(windowRange(100, 60, 99)).toEqual({ start: 0, end: 60 });
  });

  it('데이터가 VISIBLE 보다 적으면 전부', () => {
    expect(windowRange(20, 60, 0)).toEqual({ start: 0, end: 20 });
  });

  it('offset 은 0 ~ (전체 - VISIBLE) 로 제한', () => {
    expect(clampOffset(-5, 100, 60)).toBe(0);
    expect(clampOffset(55, 100, 60)).toBe(40);
    expect(clampOffset(10, 20, 60)).toBe(0);
  });

  it('오른쪽으로 끌면(dx>0) 과거로, 캔들 폭 단위로 반올림', () => {
    expect(dragOffset(0, 50, 5)).toBe(10);
    expect(dragOffset(10, -24, 5)).toBe(5);
    expect(dragOffset(0, 2, 5)).toBe(0);
    expect(dragOffset(7, 50, 0)).toBe(7); // 폭 측정 전
  });

  it('최신을 보고 있으면 새 캔들을 따라가고, 과거를 보고 있으면 화면이 그대로', () => {
    expect(offsetAfterGrowth(0, 100, 101)).toBe(0);
    expect(offsetAfterGrowth(12, 100, 101)).toBe(13);
    expect(offsetAfterGrowth(12, 100, 100)).toBe(12);
    expect(offsetAfterGrowth(12, 100, 90)).toBe(12); // 줄어든 재로드는 그대로(제한은 그리는 쪽 clamp)
  });
});

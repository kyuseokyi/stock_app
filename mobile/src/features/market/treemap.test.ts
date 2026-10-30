import { fitLabel, squarify, tileLabelLevel } from './treemap';

const rect = { x: 0, y: 0, w: 350, h: 220 };
const EPS = 1e-6;

describe('squarify', () => {
  const items = [30, 20, 15, 10, 8, 7, 5, 3, 1, 1].map((size, i) => ({ id: `g${i}`, size }));

  it('면적 합 = 사각형 면적, 크기에 비례', () => {
    const out = squarify(items, rect);
    expect(out).toHaveLength(items.length);
    const sum = out.reduce((a, p) => a + p.w * p.h, 0);
    expect(sum).toBeCloseTo(rect.w * rect.h, 3);
    const total = items.reduce((a, i) => a + i.size, 0);
    const first = out.find((p) => p.id === 'g0')!;
    expect(first.w * first.h).toBeCloseTo((30 / total) * rect.w * rect.h, 3);
  });

  it('모든 칸이 경계 안', () => {
    for (const p of squarify(items, rect)) {
      expect(p.x).toBeGreaterThanOrEqual(-EPS);
      expect(p.y).toBeGreaterThanOrEqual(-EPS);
      expect(p.x + p.w).toBeLessThanOrEqual(rect.w + EPS);
      expect(p.y + p.h).toBeLessThanOrEqual(rect.h + EPS);
    }
  });

  it('size ≤ 0·NaN 은 빠지고, 빈 목록·빈 사각형은 []', () => {
    const out = squarify([{ id: 'a', size: 5 }, { id: 'b', size: 0 }, { id: 'c', size: -1 }, { id: 'd', size: NaN }], rect);
    expect(out.map((p) => p.id)).toEqual(['a']);
    expect(out[0]).toMatchObject({ x: 0, y: 0, w: 350, h: 220 });
    expect(squarify([], rect)).toEqual([]);
    expect(squarify(items, { x: 0, y: 0, w: 0, h: 220 })).toEqual([]);
  });
});

describe('tileLabelLevel', () => {
  it('작은 칸은 글자 생략, 중간은 이름만, 큰 칸은 이름+등락률', () => {
    expect(tileLabelLevel(30, 50)).toBe(0);
    expect(tileLabelLevel(80, 20)).toBe(0);
    expect(tileLabelLevel(60, 30)).toBe(1);
    expect(tileLabelLevel(60, 40)).toBe(2);
  });
});

describe('fitLabel', () => {
  it('들어가면 그대로, 안 들어가면 말줄임', () => {
    expect(fitLabel('반도체', 60)).toBe('반도체');
    expect(fitLabel('2차전지(소재)', 200)).toBe('2차전지(소재)');
    expect(fitLabel('전기전자부품', 40)).toBe('전기…');
    expect(fitLabel('반도체', 5)).toBe('');
  });
});

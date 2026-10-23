import type { PatternItem } from '@/features/patterns/types';

import { pickToday } from './today-picks';
import type { CanslimItem } from './types';

const c = (ticker: string, score: number): CanslimItem => ({
  ticker, name: ticker, market: 'KOSDAQ', sectorName: null, close: 1000, score, passCount: 4, liquid: true,
  letters: { c: 1, a: 1, n: 1, s: 1, l: 0, i: 0, m: 0 }, rs: null, pctFromHigh: null,
});
const p = (ticker: string, dist: number | null, isActive = true, type = 'cup'): PatternItem => ({
  ticker, name: ticker, market: 'KOSDAQ', sectorName: null, close: 1000, patternType: type, label: '', stage: 1,
  pivot: 1000, pivotDistPct: dist, depth: 20, length: 40, isActive,
  breakoutDate: null, breakoutPricePct: null, breakoutVolPct: null, daysSinceBreakout: null,
});

describe('pickToday', () => {
  it('50점 이상·피벗 -15~+5% 만, 점수 높은 순 → 같으면 피벗 가까운 순', () => {
    const r = pickToday(
      [c('A', 75), c('B', 60), c('C', 60), c('D', 49), c('E', 80)],
      [p('A', -13), p('B', 3.7), p('C', 0.9), p('D', 0), p('E', -20)],
    );
    expect(r.map((x) => x.ticker)).toEqual(['A', 'C', 'B']);
  });

  it('종목에 패턴이 여럿이면 피벗에 가장 가까운 것, 돌파한(비활성) 패턴은 제외', () => {
    const r = pickToday([c('A', 70)], [p('A', -10, true, 'cup'), p('A', -2, true, 'flat_base'), p('A', 0, false)]);
    expect(r).toHaveLength(1);
    expect(r[0].pattern.patternType).toBe('flat_base');
  });

  it('n 개까지만', () => {
    const many = Array.from({ length: 12 }, (_, i) => `T${String(i).padStart(2, '0')}`);
    expect(pickToday(many.map((t) => c(t, 60)), many.map((t) => p(t, 1)))).toHaveLength(10);
  });
});

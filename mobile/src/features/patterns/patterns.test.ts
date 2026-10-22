import {
  breakoutText,
  currentBase,
  INITIAL_PATTERN_QUERY,
  patternChartLines,
  patternLabel,
  PATTERN_TYPES,
  pivotDistPct,
  REPORTS,
  reportDescription,
  samePatternQuery,
  stageText,
  togglePatternType,
} from './patterns';
import type { PatternBase } from './types';

const base = (over: Partial<PatternBase> = {}): PatternBase => ({
  patternType: 'cup', label: '1', stage: 1, subcount: 0, totalcount: 1, rimDate: null, lowDate: null, lowPrice: null,
  pivot: 100, depth: 20, length: 40, isActive: true, isCurrent: false, breakoutDate: null, breakoutPricePct: null,
  breakoutVolPct: null, daysSinceBreakout: null, priorUptrendPct: null, confidence: 0.8, points: [], ...over,
});
const colors = { pivot: 'p', buy: 'b', stop: 's' };

describe('차트 패턴 순수 함수', () => {
  it('리포트·패턴 상수와 한국어 라벨', () => {
    expect(REPORTS.map((r) => r.label)).toEqual(['형성 중', '피벗 근접', '오늘 돌파', '최근 돌파']);
    expect(PATTERN_TYPES.map((p) => p.label)).toEqual(['컵', '컵핸들', '쌍바닥', '플랫 베이스', '박스권', 'HTF']);
    expect(patternLabel('cup_with_handle')).toBe('컵핸들');
    expect(patternLabel('unknown')).toBe('unknown');
    expect(reportDescription('near_pivot')).toContain('90~105%');
  });

  it('단계 표기', () => {
    expect(stageText(1, '1')).toBe('1단계');
    expect(stageText(2, '2a')).toBe('2단계 (2a)');
    expect(stageText(3, '')).toBe('3단계');
  });

  it('같은 필터 비교·패턴 칩 토글', () => {
    expect(samePatternQuery(INITIAL_PATTERN_QUERY, { report: 'forming', patternType: null })).toBe(true);
    expect(samePatternQuery(INITIAL_PATTERN_QUERY, { report: 'forming', patternType: 'cup' })).toBe(false);
    expect(samePatternQuery(INITIAL_PATTERN_QUERY, { report: 'near_pivot', patternType: null })).toBe(false);
    expect(togglePatternType(null, 'htf')).toBe('htf');
    expect(togglePatternType('htf', 'htf')).toBeNull();
    expect(togglePatternType('htf', 'cup')).toBe('cup');
  });

  it('돌파 문구·피벗 거리', () => {
    expect(breakoutText(true, null)).toBe('형성 중');
    expect(breakoutText(false, 3)).toBe('돌파 3일째');
    expect(breakoutText(false, null)).toBe('돌파');
    expect(pivotDistPct(98, 100)).toBeCloseTo(-2);
    expect(pivotDistPct(null, 100)).toBeNull();
    expect(pivotDistPct(98, 0)).toBeNull();
    expect(pivotDistPct(NaN, 100)).toBeNull();
  });

  it('현재 베이스 고르기', () => {
    const cur = base({ label: 'cur', isCurrent: true });
    expect(currentBase([base(), cur, base({ isCurrent: true, label: 'x' })])).toBe(cur);
    expect(currentBase([base()])).toBeNull();
    expect(currentBase([])).toBeNull();
    expect(currentBase(null)).toBeNull();
  });

  it('차트 선 — 피벗 실선, 매수 상단·손절 점선, zones 없으면 피벗만', () => {
    const zones = { buyLow: 100, buyHigh: 105, stopLow: 92, stopHigh: 95 };
    const lines = patternChartLines(100, zones, colors);
    expect(lines.map((l) => [l.title, l.price, l.dashed])).toEqual([
      ['피벗', 100, false],
      ['매수 상단', 105, true],
      ['손절', 95, true],
    ]);
    expect(patternChartLines(100, null, colors)).toHaveLength(1);
    expect(patternChartLines(NaN, zones, colors)).toEqual([]);
  });
});

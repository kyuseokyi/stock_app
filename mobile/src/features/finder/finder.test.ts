import { mergeLeaderPage } from '@/features/leaders/canslim';

import {
  activeFilterCount,
  BB_SIGMAS,
  bbPositionLabel,
  DEFAULT_FINDER_FILTERS,
  FINDER_PAGE,
  fromDraft,
  gcLabel,
  INITIAL_QUERY,
  maOrderLabel,
  NUM_KEYS,
  parseNum,
  PRESETS,
  rsiTone,
  sameFinderQuery,
  sigmaLabel,
  toDraft,
  toFilterInput,
  togglePreset,
} from './finder';
import type { FinderFilters, FinderItem } from './types';

const item = (ticker: string): FinderItem => ({
  ticker,
  name: ticker,
  market: 'KOSPI',
  sectorName: null,
  close: 1000,
  chg1d: 1.5,
  value: 1e9,
  mcap: null,
  volRatio20: 2.1,
  rsi14: 45,
  maOrder: 0,
  isNewHigh: false,
  gcDays: null,
  vpAbovePct: null,
  per: null,
  pbr: null,
  roe: null,
  bbPosition: null,
  bbWidthPct: null,
});

describe('조건검색 순수 함수', () => {
  it('parseNum — 빈칸·공백·콤마·음수·숫자 아님·무한대', () => {
    expect(parseNum('')).toBeNull();
    expect(parseNum('   ')).toBeNull();
    expect(parseNum(' 1,000 ')).toBe(1000);
    expect(parseNum('-3.5')).toBe(-3.5);
    expect(parseNum('abc')).toBeNull();
    expect(parseNum('1e999')).toBeNull();
  });

  it('toDraft → fromDraft 왕복', () => {
    const d = toDraft(DEFAULT_FINDER_FILTERS);
    expect(d.priceMin).toBe('');
    expect(fromDraft(d)).toEqual(DEFAULT_FINDER_FILTERS);
    const f: FinderFilters = { ...DEFAULT_FINDER_FILTERS, market: 'KOSDAQ', rsiMax: 30, roeMin: -5, bbSigma: 1.5 };
    expect(fromDraft(toDraft(f))).toEqual(f);
  });

  it('fromDraft — 잘못 쓴 숫자 칸은 조건 없음(null)', () => {
    const f = fromDraft({ ...toDraft(DEFAULT_FINDER_FILTERS), priceMin: '만원', perMax: '15' });
    expect(f.priceMin).toBeNull();
    expect(f.perMax).toBe(15);
  });

  it('fromDraft — 음수는 ROE·매출 성장률만 허용, 나머지는 서버가 무시하므로 null', () => {
    const f = fromDraft({
      ...toDraft(DEFAULT_FINDER_FILTERS),
      priceMin: '-100', rsiMin: '-5', debtRatioMax: '-1', bbWidthMax: '-3', roeMin: '-5', salesGrowthMin: '-10',
    });
    expect(f.priceMin).toBeNull();
    expect(f.rsiMin).toBeNull();
    expect(f.debtRatioMax).toBeNull();
    expect(f.bbWidthMax).toBeNull();
    expect(f.roeMin).toBe(-5);
    expect(f.salesGrowthMin).toBe(-10);
    expect(activeFilterCount(f)).toBe(2);
  });

  it('fromDraft — min 이 max 보다 큰 범위는 둘 다 null(서버 규칙), 같거나 한쪽만이면 유지', () => {
    const base = toDraft(DEFAULT_FINDER_FILTERS);
    const flipped = fromDraft({ ...base, priceMin: '5000', priceMax: '1000', perMin: '3', perMax: '3', pbrMin: '2' });
    expect(flipped.priceMin).toBeNull();
    expect(flipped.priceMax).toBeNull();
    expect(flipped.perMin).toBe(3);
    expect(flipped.perMax).toBe(3);
    expect(flipped.pbrMin).toBe(2);
    expect(activeFilterCount(flipped)).toBe(3);
  });

  it('toFilterInput — 기본값은 시장·거래 활발만 보낸다', () => {
    expect(toFilterInput(DEFAULT_FINDER_FILTERS)).toEqual({ market: 'ALL', liquidOnly: true });
  });

  it('toFilterInput — 값 있는 칸만, σ 는 볼린저 조건이 있을 때만', () => {
    const f: FinderFilters = { ...DEFAULT_FINDER_FILTERS, liquidOnly: false, mcapMin: 500, maOrder: 'PERFECT', bbSigma: 2.5 };
    expect(toFilterInput(f)).toEqual({ market: 'ALL', liquidOnly: false, mcapMin: 500, maOrder: 'PERFECT' });
    expect(toFilterInput({ ...f, bbPosition: 'BELOW' })).toEqual({
      market: 'ALL',
      liquidOnly: false,
      mcapMin: 500,
      maOrder: 'PERFECT',
      bbPosition: 'BELOW',
      bbSigma: 2.5,
    });
    expect(toFilterInput({ ...DEFAULT_FINDER_FILTERS, bbWidthMax: 10 })).toEqual({
      market: 'ALL',
      liquidOnly: true,
      bbWidthMax: 10,
      bbSigma: 2,
    });
  });

  it('activeFilterCount — 기본값은 0', () => {
    expect(activeFilterCount(DEFAULT_FINDER_FILTERS)).toBe(0);
  });

  it('activeFilterCount — 시장·거래 활발 끔·배열·볼린저 위치·숫자 칸마다 1, σ 만 바꾼 것은 0', () => {
    expect(activeFilterCount({ ...DEFAULT_FINDER_FILTERS, bbSigma: 3 })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FINDER_FILTERS,
        market: 'KOSPI',
        liquidOnly: false,
        maOrder: 'REVERSE',
        bbPosition: 'ABOVE',
        priceMin: 1000,
        priceMax: 5000,
      }),
    ).toBe(6);
  });

  it('sameFinderQuery — 프리셋·정렬·필터가 모두 같을 때만 같다', () => {
    const a = INITIAL_QUERY;
    expect(sameFinderQuery(a, { ...a, filters: { ...a.filters } })).toBe(true);
    expect(sameFinderQuery(a, { ...a, preset: 'oversold' })).toBe(false);
    expect(sameFinderQuery(a, { ...a, sort: 'chg' })).toBe(false);
    expect(sameFinderQuery(a, { ...a, filters: { ...a.filters, rsiMax: 30 } })).toBe(false);
  });

  it('togglePreset — 같은 프리셋을 다시 누르면 해제, 다른 것은 바꾼다', () => {
    expect(togglePreset(null, 'oversold')).toBe('oversold');
    expect(togglePreset('oversold', 'oversold')).toBeNull();
    expect(togglePreset('oversold', 'new_high')).toBe('new_high');
  });

  it('상수 — 프리셋 키는 서버와 같고 페이지 50·숫자 칸 17·σ 5개', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['volume_surge', 'golden_cross', 'oversold', 'new_high']);
    expect(FINDER_PAGE).toBe(50);
    expect(NUM_KEYS).toHaveLength(17);
    expect(BB_SIGMAS).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(INITIAL_QUERY).toEqual({ preset: null, sort: 'value', filters: DEFAULT_FINDER_FILTERS });
  });

  it('배지·표 글자', () => {
    expect(gcLabel(null)).toBeNull();
    expect(gcLabel(0)).toBe('골든크로스 오늘');
    expect(gcLabel(2)).toBe('골든크로스 2일 전');
    expect(maOrderLabel(1)).toBe('정배열');
    expect(maOrderLabel(-1)).toBe('역배열');
    expect(maOrderLabel(0)).toBeNull();
    expect(bbPositionLabel('ABOVE')).toBe('상단 돌파');
    expect(bbPositionLabel('BELOW')).toBe('하단 이탈');
    expect(bbPositionLabel('INSIDE')).toBe('밴드 안');
    expect(bbPositionLabel(null)).toBe('–');
    expect(sigmaLabel(1.5)).toBe('1.5σ');
    expect(sigmaLabel(2)).toBe('2σ');
  });

  it('rsiTone — 30 이하 파랑(down)·70 이상 빨강(up)·그 밖 flat', () => {
    expect(rsiTone(30)).toBe('down');
    expect(rsiTone(70)).toBe('up');
    expect(rsiTone(50)).toBe('flat');
  });

  it('mergeLeaderPage — 조건검색 항목도 같은 티커는 한 번만', () => {
    expect(mergeLeaderPage([item('A'), item('B')], [item('B'), item('C')]).map((x) => x.ticker)).toEqual(['A', 'B', 'C']);
  });
});

import {
  activeFilterCount,
  DEFAULT_FILTERS,
  hasMoreLeaders,
  high52w,
  historyPoints,
  LETTER_KEYS,
  letterStatusText,
  letterTone,
  listView,
  marketTone,
  mergeLeaderPage,
  scoreView,
  toggleRequired,
} from './canslim';
import type { CanslimItem } from './types';

const item = (ticker: string): CanslimItem => ({
  ticker,
  name: ticker,
  market: 'KOSPI',
  sectorName: null,
  close: 1000,
  score: 50,
  passCount: 3,
  liquid: true,
  letters: { c: 1, a: 1, n: 0, s: 0, l: 1, i: -1, m: -2 },
  rs: 80,
  pctFromHigh: -3.5,
});

describe('항목 표시', () => {
  it('항목 순서는 C A N S L I M', () => {
    expect(LETTER_KEYS.join('')).toBe('canslim');
  });
  it('상태 글자 — 통과·미달·준비 중·데이터 부족', () => {
    expect(letterStatusText(1)).toBe('통과');
    expect(letterStatusText(0)).toBe('미달');
    expect(letterStatusText(-2)).toBe('준비 중');
    expect(letterStatusText(-1)).toBe('데이터 부족');
  });
  it('배지 색 구분 — 통과 pass, 미달 fail, 부족·준비 중 none', () => {
    expect(letterTone(1)).toBe('pass');
    expect(letterTone(0)).toBe('fail');
    expect(letterTone(-1)).toBe('none');
    expect(letterTone(-2)).toBe('none');
  });
  it('시장 상태 색 — 상승 추세=up, 하락=down, 그 밖=flat', () => {
    expect(marketTone('상승 추세')).toBe('up');
    expect(marketTone('하락')).toBe('down');
    expect(marketTone('조정')).toBe('flat');
    expect(marketTone('')).toBe('flat');
  });
});

describe('52주 고점', () => {
  it('종가와 고점 대비 %로 되돌려 계산', () => {
    expect(high52w(90, -10)).toBeCloseTo(100);
    expect(high52w(100, 0)).toBe(100);
  });
  it('값이 없거나 -100% 이하면 null', () => {
    expect(high52w(100, null)).toBeNull();
    expect(high52w(100, -100)).toBeNull();
    expect(high52w(100, -150)).toBeNull();
  });
});

describe('필터', () => {
  it('기본값은 웹 DEFAULT_FILTERS 와 같다', () => {
    expect(DEFAULT_FILTERS).toEqual({ market: 'ALL', minPass: 0, required: [], sort: 'score', liquidOnly: true });
  });
  it('꼭 통과 항목 토글 — 없으면 뒤에 추가, 있으면 제거(원본 불변)', () => {
    const base = ['c' as const];
    expect(toggleRequired(base, 'l')).toEqual(['c', 'l']);
    expect(toggleRequired(base, 'c')).toEqual([]);
    expect(base).toEqual(['c']);
  });
  it('적용 중인 필터 수 — 기본은 0, 정렬은 세지 않는다', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, sort: 'rs' })).toBe(0);
  });
  it('적용 중인 필터 수 — 시장·최소 통과·거래 활발은 1씩, 꼭 통과는 고른 개수만큼', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, market: 'KOSDAQ' })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, minPass: 5 })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, liquidOnly: false })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, required: ['c', 'a', 'l'] })).toBe(3);
    expect(
      activeFilterCount({ market: 'KOSPI', minPass: 3, required: ['n'], sort: 'passCount', liquidOnly: false }),
    ).toBe(4);
  });
});

describe('목록 페이지', () => {
  it('이어 붙일 때 같은 티커는 한 번만(앞 페이지 것을 유지)', () => {
    const merged = mergeLeaderPage([item('A'), item('B')], [item('B'), item('C')]);
    expect(merged.map((x) => x.ticker)).toEqual(['A', 'B', 'C']);
  });
  it('더 불러오기 — 마지막 페이지가 50개로 꽉 찼고 total 보다 적을 때만', () => {
    expect(hasMoreLeaders(50, 120, 50)).toBe(true);
    expect(hasMoreLeaders(100, 100, 50)).toBe(false);
    expect(hasMoreLeaders(70, 120, 20)).toBe(false);
    expect(hasMoreLeaders(0, 0, 0)).toBe(false);
  });
});

describe('화면 상태', () => {
  it('목록 — 항목이 있으면 다시 불러오는 중·오류여도 목록', () => {
    expect(listView({ loading: true, error: null, date: '2026-10-20', count: 3 })).toBe('list');
    expect(listView({ loading: false, error: 'NETWORK', date: '2026-10-20', count: 3 })).toBe('list');
  });
  it('목록 — 항목이 없으면 로딩 > 오류 > 준비 중(date null) > 0건', () => {
    expect(listView({ loading: true, error: null, date: null, count: 0 })).toBe('loading');
    expect(listView({ loading: false, error: 'NETWORK', date: null, count: 0 })).toBe('error');
    expect(listView({ loading: false, error: null, date: null, count: 0 })).toBe('preparing');
    expect(listView({ loading: false, error: null, date: '2026-10-20', count: 0 })).toBe('empty');
  });
  it('상세 점수 — 데이터가 있으면 ready, 없으면 로딩·오류·비대상(null)', () => {
    expect(scoreView({ loading: false, error: 'NETWORK', data: { score: 1 } })).toBe('ready');
    expect(scoreView({ loading: true, error: null, data: null })).toBe('loading');
    expect(scoreView({ loading: false, error: 'GRAPHQL', data: null })).toBe('error');
    expect(scoreView({ loading: false, error: null, data: null })).toBe('none');
  });
});

describe('점수 추이 좌표', () => {
  it('0~100점을 높이에 맞춰 위아래 반전(기본 240×40)', () => {
    const h = [0, 50, 100].map((score, i) => ({ date: `d${i}`, score, passCount: 0 }));
    expect(historyPoints(h)).toBe('0,40 120,20 240,0');
  });
  it('점이 2개 미만이면 null', () => {
    expect(historyPoints([])).toBeNull();
    expect(historyPoints([{ date: 'd', score: 10, passCount: 1 }])).toBeNull();
  });
});

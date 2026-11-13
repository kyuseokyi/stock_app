import type { Mover } from '@/features/market/rest-types';

import { pickHomeIndices, sectionPhase, showStaleNotice, topMovers } from './summary';

const mover = (ticker: string): Mover => ({
  ticker,
  stockName: ticker,
  price: null,
  changeRate: null,
  reasonSummary: null,
  category: null,
  reliability: null,
  riskWarning: null,
  sources: [],
});
const movers = (...tickers: string[]) => tickers.map(mover);

describe('pickHomeIndices', () => {
  it('응답 순서와 상관없이 코스피·코스닥·원/달러 순으로 고른다', () => {
    const got = pickHomeIndices([{ code: 'FX:USDKRW' }, { code: 'US:SPX' }, { code: 'KR:1001' }, { code: 'KR:0001' }]);
    expect(got.map((i) => i.code)).toEqual(['KR:0001', 'KR:1001', 'FX:USDKRW']);
  });

  it('응답에 없는 지수는 건너뛴다', () => {
    expect(pickHomeIndices([{ code: 'KR:1001' }]).map((i) => i.code)).toEqual(['KR:1001']);
    expect(pickHomeIndices([])).toEqual([]);
  });
});

describe('topMovers', () => {
  it('각 묶음을 상위 3개로 자른다', () => {
    const got = topMovers({ gainers: movers('a', 'b', 'c', 'd'), losers: movers('e', 'f', 'g', 'h', 'i') });
    expect(got.gainers.map((m) => m.ticker)).toEqual(['a', 'b', 'c']);
    expect(got.losers.map((m) => m.ticker)).toEqual(['e', 'f', 'g']);
  });

  it('3개보다 적으면 있는 만큼 돌려준다', () => {
    expect(topMovers({ gainers: movers('a'), losers: [] }).gainers).toHaveLength(1);
  });

  it('처음 고르는 쪽은 급등, 급등이 없고 급락만 있으면 급락이다', () => {
    expect(topMovers({ gainers: movers('a'), losers: movers('b') }).initialSide).toBe('gainers');
    expect(topMovers({ gainers: [], losers: movers('b') }).initialSide).toBe('losers');
    expect(topMovers({ gainers: [], losers: [] }).initialSide).toBe('gainers');
  });

  it('아직 데이터가 없으면 빈 묶음이다', () => {
    expect(topMovers(null)).toEqual({ gainers: [], losers: [], initialSide: 'gainers' });
  });
});

describe('sectionPhase', () => {
  it('첫 로딩 중에는 자리를 잡는다', () => {
    expect(sectionPhase(true, false)).toBe('loading');
  });

  it('값이 있으면 재조회 중에도 보인다', () => {
    expect(sectionPhase(true, true)).toBe('visible');
    expect(sectionPhase(false, true)).toBe('visible');
  });

  it('실패·빈 응답이면 숨긴다', () => {
    expect(sectionPhase(false, false)).toBe('hidden');
  });
});

describe('showStaleNotice', () => {
  it('지수나 급등락 중 하나라도 보이면 안내한다', () => {
    expect(showStaleNotice(3, 0)).toBe(true);
    expect(showStaleNotice(0, 2)).toBe(true);
  });

  it('시세가 하나도 없으면 안내하지 않는다', () => {
    expect(showStaleNotice(0, 0)).toBe(false);
  });
});

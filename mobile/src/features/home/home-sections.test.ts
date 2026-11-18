import type { FundEntry } from '@/features/fund/core';

import { HOME_FUND_LIMIT, homeFundCardState, homeReferenceIndices, marketStripPhase } from './home-sections';

const fund = (id: string) => ({ id, url: `https://fund.ivyro.net/${id}`, name: id }) as unknown as FundEntry;
const base = { hydrated: true, uid: 7, funds: [] as FundEntry[] | null, failed: false };

describe('homeFundCardState (홈 내 펀드 카드)', () => {
  it('로그인 복원 전에는 로딩 — 로그인 사용자에게 로그인 안내가 깜박이지 않게', () => {
    expect(homeFundCardState({ ...base, hydrated: false, uid: null })).toEqual({ kind: 'loading' });
  });
  it('비로그인이면 펀드 목록과 상관없이 로그인 안내', () => {
    expect(homeFundCardState({ ...base, uid: null })).toEqual({ kind: 'guest' });
    expect(homeFundCardState({ ...base, uid: null, funds: [fund('a')] })).toEqual({ kind: 'guest' });
  });
  it('목록을 읽는 중이면 로딩 — 등록 안내가 먼저 보이지 않게', () => {
    expect(homeFundCardState({ ...base, funds: null })).toEqual({ kind: 'loading' });
  });
  it('읽기 실패는 등록 안내가 아니라 실패 안내', () => {
    expect(homeFundCardState({ ...base, funds: null, failed: true })).toEqual({ kind: 'error' });
  });
  it('로그인 + 펀드 없음이면 등록 안내', () => {
    expect(homeFundCardState(base)).toEqual({ kind: 'empty' });
  });
  it('로그인 + 펀드 있음이면 앞에서부터 최대 3개와 남은 개수', () => {
    expect(homeFundCardState({ ...base, funds: [fund('a')] })).toEqual({ kind: 'funds', funds: [fund('a')], more: 0 });
    const many = homeFundCardState({ ...base, funds: ['a', 'b', 'c', 'd', 'e'].map(fund) });
    expect(many.kind).toBe('funds');
    if (many.kind === 'funds') {
      expect(many.funds.map((f) => f.id)).toEqual(['a', 'b', 'c']);
      expect(many.funds).toHaveLength(HOME_FUND_LIMIT);
      expect(many.more).toBe(2);
    }
  });
});

const ix = (code: string, region: string) => ({ code, region });

describe('homeReferenceIndices (홈 시장 참고 지수)', () => {
  it('코스피 · 코스닥 · 미국 대표(S&P500 우선) · 원/달러 순서 — 응답 순서와 무관', () => {
    const all = [
      ix('US:VIX', 'US'), ix('US:SOX', 'US'), ix('FX:USDKRW', 'FX'), ix('KR:1001', 'KR'),
      ix('US:COMP', 'US'), ix('US:SPX', 'US'), ix('KR:0001', 'KR'),
    ];
    expect(homeReferenceIndices(all).map((i) => i.code)).toEqual(['KR:0001', 'KR:1001', 'US:SPX', 'FX:USDKRW']);
  });
  it('S&P500 이 없으면 나스닥 종합, 그다음 다우', () => {
    expect(homeReferenceIndices([ix('US:DJI', 'US'), ix('US:COMP', 'US')]).map((i) => i.code)).toEqual(['US:COMP']);
    expect(homeReferenceIndices([ix('US:NDX', 'US'), ix('US:DJI', 'US')]).map((i) => i.code)).toEqual(['US:DJI']);
  });
  it('대표 지수가 모두 없으면 VIX·반도체는 고르지 않는다', () => {
    expect(homeReferenceIndices([ix('US:VIX', 'US'), ix('US:SOX', 'US')])).toEqual([]);
    expect(homeReferenceIndices([ix('US:VIX', 'US'), ix('US:NDX', 'US')]).map((i) => i.code)).toEqual(['US:NDX']);
  });
  it('원/달러는 FX:USDKRW 우선, 없으면 FX 첫 항목', () => {
    expect(homeReferenceIndices([ix('FX:JPYKRW', 'FX'), ix('FX:USDKRW', 'FX')]).map((i) => i.code)).toEqual(['FX:USDKRW']);
    expect(homeReferenceIndices([ix('FX:JPYKRW', 'FX')]).map((i) => i.code)).toEqual(['FX:JPYKRW']);
  });
  it('없는 지수는 건너뛴다', () => {
    expect(homeReferenceIndices([ix('KR:0001', 'KR')]).map((i) => i.code)).toEqual(['KR:0001']);
    expect(homeReferenceIndices([])).toEqual([]);
  });
});

describe('marketStripPhase (시장 참고 칸)', () => {
  it('받아 둔 값이 있으면 재조회·실패와 상관없이 표시', () => {
    expect(marketStripPhase(true, true, false)).toBe('ready');
    expect(marketStripPhase(false, true, true)).toBe('ready');
  });
  it('값 없이 실패하면 이 칸만 다시 시도', () => {
    expect(marketStripPhase(false, false, true)).toBe('failed');
  });
  it('첫 로딩·다시 시도 중이면 자리만', () => {
    expect(marketStripPhase(true, false, false)).toBe('loading');
    expect(marketStripPhase(true, false, true)).toBe('loading');
  });
});

import type { FundEntry } from '@/features/fund/core';
import type { MacroValue } from '@/features/market/types';

import {
  HOME_FUND_LIMIT,
  homeFundCardState,
  homeMacroCards,
  homeMacroSourceLine,
  homeMacroTile,
  homeReferenceEnabled,
  homeReferenceIndices,
  homeReferenceView,
  marketStripPhase,
} from './home-sections';

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

const mv = (seriesId: string, value: number, unit: string, date: string): MacroValue => ({
  seriesId, name: seriesId, unit, date, value, prev: null,
});
const MACRO = [
  mv('UNRATE', 4.2, '%', '2026-10-01'),
  mv('FEDFUNDS', 4.33, '%', '2026-10-01'),
  mv('DGS10', 4.12, '%', '2026-11-18'),
  mv('ECOS:USDKRW', 1385.2, '원', '2026-11-19'),
];
const ALL_IX = [ix('KR:0001', 'KR'), ix('KR:1001', 'KR'), ix('US:SPX', 'US'), ix('FX:USDKRW', 'FX')];
type View = ReturnType<typeof homeReferenceView<{ code: string; region: string }>>;
const codes = (v: View) => (v.mode === 'hidden' ? null : v.indices.map((i) => i.code));
const series = (v: View) => (v.mode === 'public' ? v.macro.map((m) => m.seriesId) : null);

describe('홈 거시 카드(A안 — 원/달러 ECOS·미 10년물·미 기준금리)', () => {
  it('정해진 3개만 순서대로, 없는 것은 뺀다', () => {
    expect(homeMacroCards(MACRO).map((m) => m.seriesId)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS']);
    expect(homeMacroCards([MACRO[0], MACRO[2]]).map((m) => m.seriesId)).toEqual(['DGS10']);
    expect(homeMacroCards([])).toEqual([]);
  });
  it('표시 — 원은 쉼표·소수 둘째, 일별은 MM.DD 기준, 기준금리(월별)는 월 기준', () => {
    expect(homeMacroTile(MACRO[3])).toEqual({ seriesId: 'ECOS:USDKRW', label: '원/달러 환율', value: '1,385.20원', basis: '11.19 기준' });
    expect(homeMacroTile(MACRO[2])).toMatchObject({ label: '미 10년물', value: '4.12%', basis: '11.18 기준' });
    expect(homeMacroTile(MACRO[1])).toMatchObject({ label: '미 기준금리', value: '4.33%', basis: '10월 기준' });
  });
  it('출처 한 줄 — 보이는 카드 기준', () => {
    expect(homeMacroSourceLine(homeMacroCards(MACRO))).toBe('출처: 한국은행 경제통계시스템(ECOS), FRED');
    expect(homeMacroSourceLine([{ seriesId: 'DGS10' }])).toBe('출처: FRED');
    expect(homeMacroSourceLine([])).toBeNull();
  });
});

describe('homeReferenceView (어떤 카드가 보이는가)', () => {
  it('판단값을 모르면 요청도 표시도 하지 않는다', () => {
    expect(homeReferenceEnabled(null)).toBe(false);
    expect(homeReferenceView(null, ALL_IX, MACRO)).toEqual({ mode: 'hidden' });
  });
  it('시세 열람이면 지금과 같다 — 지수 4칸, 거시 카드 없음', () => {
    const v = homeReferenceView({ marketData: true, marketIndexKr: false }, ALL_IX, MACRO);
    expect(v.mode).toBe('full');
    expect(codes(v)).toEqual(['KR:0001', 'KR:1001', 'US:SPX', 'FX:USDKRW']);
    expect(series(v)).toBeNull();
  });
  it('시세 비열람 + 국내 지수 공개 → 코스피·코스닥 + 거시 3개', () => {
    const v = homeReferenceView({ marketData: false, marketIndexKr: true }, ALL_IX, MACRO);
    expect(codes(v)).toEqual(['KR:0001', 'KR:1001']);
    expect(series(v)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS']);
  });
  it('시세 비열람 + 국내 지수 비공개 → 거시 카드만', () => {
    expect(homeReferenceEnabled({ marketData: false, marketIndexKr: false })).toBe(true);
    const v = homeReferenceView({ marketData: false, marketIndexKr: false }, ALL_IX, MACRO);
    expect(codes(v)).toEqual([]);
    expect(series(v)).toEqual(['ECOS:USDKRW', 'DGS10', 'FEDFUNDS']);
  });
  it('시세 비열람인데 거시도 지수도 없으면 숨김', () => {
    expect(homeReferenceView({ marketData: false }, [], [MACRO[0]])).toEqual({ mode: 'hidden' });
  });
});

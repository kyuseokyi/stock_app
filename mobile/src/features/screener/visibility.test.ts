import type { ScreenerFeatures } from './api';
import { screenerChipVisible, screenerEntry, screenerTabVisible, stockBackHref } from './visibility';

const f = (stockFinder: boolean, finder: boolean, patterns: boolean, marketData = true): ScreenerFeatures => ({
  stockFinder, finder, patterns, marketData, marketIndexKr: marketData,
});

describe('스크리너 노출 판정', () => {
  it('STOCK_FINDER 가 꺼지면 FINDER·PATTERNS 와 무관하게 탭·칩 모두 숨김', () => {
    for (const fi of [true, false]) {
      for (const pa of [true, false]) {
        const x = f(false, fi, pa);
        expect(screenerTabVisible(x)).toBe(false);
        expect(screenerChipVisible(x, 'leaders')).toBe(false);
        expect(screenerChipVisible(x, 'finder')).toBe(false);
        expect(screenerChipVisible(x, 'patterns')).toBe(false);
        expect(screenerEntry(x)).toBe('redirect');
        expect(stockBackHref(x)).toBe('/market');
      }
    }
  });

  it('STOCK_FINDER 가 켜지면 주도주는 항상, 조건검색·패턴은 각자 스위치대로', () => {
    const x = f(true, true, false);
    expect(screenerTabVisible(x)).toBe(true);
    expect(screenerChipVisible(x, 'leaders')).toBe(true);
    expect(screenerChipVisible(x, 'finder')).toBe(true);
    expect(screenerChipVisible(x, 'patterns')).toBe(false);
    expect(screenerChipVisible(f(true, false, true), 'patterns')).toBe(true);
    expect(screenerEntry(x)).toBe('show');
    expect(stockBackHref(x)).toBe('/screener');
  });

  it('답을 받기 전(null)은 탭 숨김·화면은 기다림·돌아가기는 마켓', () => {
    expect(screenerTabVisible(null)).toBe(false);
    expect(screenerChipVisible(null, 'leaders')).toBe(false);
    expect(screenerEntry(null)).toBe('wait');
    expect(stockBackHref(null)).toBe('/market');
  });

  it('시세 비노출(marketData=false)이면 종목 찾기 스위치가 켜져 있어도 탭·칩 숨김, 직접 진입은 마켓으로(A안)', () => {
    const x = f(true, true, true, false);
    expect(screenerTabVisible(x)).toBe(false);
    expect(screenerChipVisible(x, 'leaders')).toBe(false);
    expect(screenerEntry(x)).toBe('redirect');
    expect(stockBackHref(x)).toBe('/market');
  });
});

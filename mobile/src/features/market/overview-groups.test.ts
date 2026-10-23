import { groupOverview } from './overview-groups';
import type { MacroValue, MarketIndex } from './types';

const ix = (code: string, region: string): MarketIndex => ({
  code, name: code, region, date: '2026-10-22', close: 1, chg1d: 0, spark: [], live: false, asOf: null,
});
const mv = (seriesId: string): MacroValue => ({ seriesId, name: seriesId, unit: '%', date: '2026-10-21', value: 1, prev: null });

describe('groupOverview', () => {
  it('국내·미국·돈의 흐름으로 나누고 미국은 정해진 순서로', () => {
    const g = groupOverview(
      [ix('US:DJI', 'US'), ix('KR:0001', 'KR'), ix('US:VIX', 'US'), ix('FX:USDKRW', 'FX'), ix('US:SPX', 'US'), ix('KR:1001', 'KR')],
      [],
    );
    expect(g.kr.map((i) => i.code)).toEqual(['KR:0001', 'KR:1001']);
    expect(g.us.map((i) => i.code)).toEqual(['US:SPX', 'US:DJI']);
    expect(g.flow.map((i) => i.code)).toEqual(['FX:USDKRW', 'US:VIX']);
  });

  it('처음 보는 코드는 버리지 않고 묶음 끝에 붙인다', () => {
    const g = groupOverview([ix('US:NEW', 'US'), ix('US:SPX', 'US'), ix('FX:JPYKRW', 'FX')], []);
    expect(g.us.map((i) => i.code)).toEqual(['US:SPX', 'US:NEW']);
    expect(g.flow.map((i) => i.code)).toEqual(['FX:JPYKRW']);
  });

  it('미 국채 금리는 돈의 흐름으로, 나머지는 경제지표로', () => {
    const g = groupOverview([], [mv('CPIAUCSL'), mv('DGS2'), mv('UNRATE'), mv('DGS10')]);
    expect(g.rates.map((m) => m.seriesId)).toEqual(['DGS10', 'DGS2']);
    expect(g.otherMacro.map((m) => m.seriesId)).toEqual(['CPIAUCSL', 'UNRATE']);
  });
});

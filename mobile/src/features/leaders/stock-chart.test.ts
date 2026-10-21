import { STOCK_CHART_LOOKBACK_DAYS, STOCK_CHART_MA, STOCK_CHART_VISIBLE_DAYS, stockChartLines } from './stock-chart';

describe('종목 상세 차트 설정', () => {
  it('52주 고점이 없거나 숫자가 아니면 가격선 없음', () => {
    expect(stockChartLines(null, '#999999')).toEqual([]);
    expect(stockChartLines(Number.NaN, '#999999')).toEqual([]);
  });
  it('52주 고점은 점선·자동 범위 포함(화면 밖으로 사라지지 않게), 50일선·1년 화면·워밍업 기간', () => {
    expect(stockChartLines(72800, '#999999')).toEqual([
      { price: 72800, color: '#999999', width: 1, dashed: true, title: '52주 고점', fit: 'day' },
    ]);
    expect(STOCK_CHART_MA).toEqual([50]);
    expect(STOCK_CHART_VISIBLE_DAYS).toBe(365);
    expect(STOCK_CHART_LOOKBACK_DAYS).toBeGreaterThanOrEqual(STOCK_CHART_VISIBLE_DAYS + 70);
  });
});

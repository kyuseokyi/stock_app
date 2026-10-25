import { DEFAULT_CHART_PREFS, parseChartPrefs, serializeChartPrefs } from './chart-prefs';

describe('차트 설정 저장값', () => {
  it('없거나 깨진 값은 기본(관리자 기본 단위 · 이동평균 켜짐 · 볼린저·매물대 꺼짐)', () => {
    expect(parseChartPrefs(null)).toEqual(DEFAULT_CHART_PREFS);
    expect(parseChartPrefs('{oops')).toEqual(DEFAULT_CHART_PREFS);
    expect(DEFAULT_CHART_PREFS).toEqual({ interval: null, ma: true, bb: false, vp: false });
  });

  it('저장한 그대로 복원', () => {
    const prefs = { interval: '1m' as const, ma: false, bb: true, vp: true };
    expect(parseChartPrefs(serializeChartPrefs(prefs))).toEqual(prefs);
  });

  it('형식이 틀린 필드만 기본값으로', () => {
    expect(parseChartPrefs('{"interval":"3m","ma":"yes","bb":true}')).toEqual({ interval: null, ma: true, bb: true, vp: false });
  });
});

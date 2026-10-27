import { srLevelsFromTrends, srName, srSignature, TREND_HIGH_COLOR, TREND_LOW_COLOR, type SrLevel } from './sr-levels';

describe('srLevelsFromTrends', () => {
  const res = { i1: 0, p1: 100, i2: 10, p2: 110 }; // 마지막 순번 20 → 120
  const sup = { i1: 0, p1: 80, i2: 10, p2: 90 }; // 마지막 순번 20 → 100
  test('마지막 캔들 위치 값, 현재가 기준 역할', () => {
    const got = srLevelsFromTrends({ resistance: res, support: sup }, 20, 110);
    expect(got).toEqual([
      { key: 'trendHigh', price: 120, color: TREND_HIGH_COLOR, role: 'resistance' },
      { key: 'trendLow', price: 100, color: TREND_LOW_COLOR, role: 'support' },
    ]);
  });
  test('돌파하면 역할만 반전, 색은 그대로', () => {
    const got = srLevelsFromTrends({ resistance: res, support: sup }, 20, 130);
    expect(got[0]).toMatchObject({ key: 'trendHigh', role: 'support', color: TREND_HIGH_COLOR });
  });
  test('현재가와 같은 값은 저항', () => {
    expect(srLevelsFromTrends({ resistance: res, support: null }, 20, 120)[0].role).toBe('resistance');
  });
  test('없는 선·0 이하 값은 뺌', () => {
    expect(srLevelsFromTrends({ resistance: null, support: null }, 20, 100)).toEqual([]);
    expect(srLevelsFromTrends({ resistance: { i1: 0, p1: 10, i2: 1, p2: 5 }, support: null }, 20, 100)).toEqual([]);
  });
});

describe('srName', () => {
  test('넓게·좁게', () => {
    expect(srName('trendHigh', false)).toBe('저항 추세선');
    expect(srName('trendLow', false)).toBe('지지 추세선');
    expect(srName('trendHigh', true)).toBe('저항 추세');
    expect(srName('trendLow', true)).toBe('지지 추세');
  });
});

describe('srSignature', () => {
  test('호가 안의 작은 변화는 같은 서명', () => {
    const a: SrLevel[] = [{ key: 'trendHigh', role: 'resistance', price: 71_210, color: '#x' }];
    const b: SrLevel[] = [{ key: 'trendHigh', role: 'resistance', price: 71_240, color: '#x' }];
    expect(srSignature(a)).toBe(srSignature(b));
  });
  test('역할이 바뀌면 다른 서명', () => {
    const a: SrLevel[] = [{ key: 'trendHigh', role: 'resistance', price: 100, color: '#x' }];
    const b: SrLevel[] = [{ key: 'trendHigh', role: 'support', price: 100, color: '#x' }];
    expect(srSignature(a)).not.toBe(srSignature(b));
  });
});

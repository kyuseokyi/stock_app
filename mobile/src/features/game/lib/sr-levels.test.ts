import { srFromIndicators, srWatchLevels, srEventName, srLevelsFromHorizontal, srRoleName, srSignature, TREND_HIGH_COLOR, TREND_LOW_COLOR, type SrLevel } from './sr-levels';

describe('srLevelsFromHorizontal', () => {
  test('저항 먼저, 키는 lvl:가격, 역할·색', () => {
    const got = srLevelsFromHorizontal({ resistance: { i: 3, price: 120 }, support: { i: 5, price: 100 } });
    expect(got).toEqual([
      { key: 'lvl:120', price: 120, color: TREND_HIGH_COLOR, role: 'resistance' },
      { key: 'lvl:100', price: 100, color: TREND_LOW_COLOR, role: 'support' },
    ]);
  });
  test('없는 쪽은 뺌', () => {
    expect(srLevelsFromHorizontal({ resistance: null, support: null })).toEqual([]);
    expect(srLevelsFromHorizontal({ resistance: null, support: { i: 1, price: 7 } })).toHaveLength(1);
  });
});

describe('srWatchLevels', () => {
  test('후보 전부를 키 lvl:가격, 현재가 기준 역할·색으로', () => {
    const got = srWatchLevels([{ i: 1, price: 120 }, { i: 2, price: 100 }, { i: 3, price: 110 }], 110);
    expect(got).toEqual([
      { key: 'lvl:120', price: 120, color: TREND_HIGH_COLOR, role: 'resistance' },
      { key: 'lvl:100', price: 100, color: TREND_LOW_COLOR, role: 'support' },
      { key: 'lvl:110', price: 110, color: TREND_HIGH_COLOR, role: 'resistance' },
    ]);
  });
});

describe('srRoleName·srEventName', () => {
  test('넓게·좁게', () => {
    expect(srRoleName('resistance', false)).toBe('저항선');
    expect(srRoleName('support', false)).toBe('지지선');
    expect(srRoleName('resistance', true)).toBe('저항');
    expect(srRoleName('support', true)).toBe('지지');
  });
  test('이벤트 종류로 이름', () => {
    expect(srEventName('RESISTANCE_TOUCH')).toBe('저항선');
    expect(srEventName('RESISTANCE_BREAKOUT')).toBe('저항선');
    expect(srEventName('SUPPORT_TOUCH')).toBe('지지선');
    expect(srEventName('SUPPORT_BREAKDOWN')).toBe('지지선');
  });
});

describe('srSignature', () => {
  test('호가 안의 작은 변화는 같은 서명', () => {
    const a: SrLevel[] = [{ key: 'lvl:71210', role: 'resistance', price: 71_210, color: '#x' }];
    const b: SrLevel[] = [{ key: 'lvl:71210', role: 'resistance', price: 71_240, color: '#x' }];
    expect(srSignature(a)).toBe(srSignature(b));
  });
  test('역할이 바뀌면 다른 서명', () => {
    const a: SrLevel[] = [{ key: 'lvl:100', role: 'resistance', price: 100, color: '#x' }];
    const b: SrLevel[] = [{ key: 'lvl:100', role: 'support', price: 100, color: '#x' }];
    expect(srSignature(a)).not.toBe(srSignature(b));
  });
});

describe('srFromIndicators', () => {
  test('키 ind:id, 현재가 이상 저항·미만 지지, 이름 포함', () => {
    const got = srFromIndicators([{ id: 'ma20', name: '20일선', price: 110, color: '#o' }, { id: 'bbLower', name: 'BB 하단', price: 90, color: '#b' }], 100);
    expect(got).toEqual([
      { key: 'ind:ma20', price: 110, color: TREND_HIGH_COLOR, role: 'resistance', name: '20일선' },
      { key: 'ind:bbLower', price: 90, color: TREND_LOW_COLOR, role: 'support', name: 'BB 하단' },
    ]);
  });
});

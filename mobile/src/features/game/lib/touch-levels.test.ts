import { touchedLevels, type IndicatorLevel } from './touch-levels';

const lv = (id: string, price: number): IndicatorLevel => ({ id, name: id, price, color: '#x' });

describe('touchedLevels', () => {
  // 오차: 50,000원 이상 = 호가 100, 그 아래 = 0.15%(49,950 → 약 74.9)
  const bar = { high: 51_000, low: 50_000 };

  test('고가~저가 안의 레벨은 관통으로 포함', () => {
    expect(touchedLevels(bar, [lv('ma20', 50_500)]).map((l) => l.id)).toEqual(['ma20']);
  });
  test('오차 안이면 꼬리 끝에 닿은 터치로 포함', () => {
    expect(touchedLevels(bar, [lv('a', 49_950), lv('b', 51_100)]).map((l) => l.id)).toEqual(['a', 'b']);
  });
  test('오차 밖이면 제외', () => {
    expect(touchedLevels(bar, [lv('a', 49_800), lv('b', 51_200)])).toEqual([]);
  });
  test('값이 없거나 0 이하면 제외, 순서는 입력 그대로', () => {
    expect(touchedLevels(bar, [lv('nan', NaN), lv('zero', 0), lv('bbUpper', 50_900), lv('poc', 50_100)]).map((l) => l.id))
      .toEqual(['bbUpper', 'poc']);
  });
  test('호가 반올림 가격이 같으면 먼저 온 것 하나(20일선 = BB 중심)', () => {
    expect(touchedLevels(bar, [lv('ma20', 50_520), lv('bbMiddle', 50_530), lv('ma5', 50_700)]).map((l) => l.id)).toEqual(['ma20', 'ma5']);
  });
});

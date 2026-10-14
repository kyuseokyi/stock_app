import { sideLabel } from './side';

describe('sideLabel', () => {
  test('LONG → 상승, SHORT → 하락', () => {
    expect(sideLabel('LONG')).toBe('상승');
    expect(sideLabel('SHORT')).toBe('하락');
  });
});

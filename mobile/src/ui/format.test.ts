import { formatWon, formatSignedWon, formatPct } from './format';

describe('formatWon', () => {
  test('천단위 콤마 + 원화 기호', () => {
    expect(formatWon(12450000)).toBe('₩12,450,000');
  });
  test('0', () => {
    expect(formatWon(0)).toBe('₩0');
  });
});

describe('formatSignedWon', () => {
  test('양수는 + 부호', () => {
    expect(formatSignedWon(180000)).toBe('+₩180,000');
  });
  test('음수는 - 부호(절대값 표기)', () => {
    expect(formatSignedWon(-42000)).toBe('-₩42,000');
  });
  test('0은 부호 없음', () => {
    expect(formatSignedWon(0)).toBe('₩0');
  });
});

describe('formatPct', () => {
  test('양수 + 부호, 소수 1자리', () => {
    expect(formatPct(14.4)).toBe('+14.4%');
  });
  test('음수', () => {
    expect(formatPct(-3.25)).toBe('-3.3%');
  });
  test('0', () => {
    expect(formatPct(0)).toBe('0.0%');
  });
});

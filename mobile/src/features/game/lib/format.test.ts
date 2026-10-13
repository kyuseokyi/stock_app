import { daysUntil, formatPrice, kstDateString, pnlTone } from './format';

describe('formatPrice', () => {
  test('천단위 콤마(원 단위 반올림)', () => {
    expect(formatPrice(71200)).toBe('71,200');
    expect(formatPrice(1234567.6)).toBe('1,234,568');
  });
});

describe('kstDateString', () => {
  test('UTC 15:00 이후는 KST 다음 날', () => {
    expect(kstDateString(new Date('2026-10-13T15:00:00Z'))).toBe('2026-10-14');
  });
  test('UTC 14:59 는 KST 같은 날', () => {
    expect(kstDateString(new Date('2026-10-13T14:59:59Z'))).toBe('2026-10-13');
  });
});

describe('daysUntil', () => {
  const now = new Date('2026-10-13T01:00:00Z'); // KST 10-13 10:00
  test('end 없음 → null', () => {
    expect(daysUntil(null, now)).toBeNull();
  });
  test('KST 날짜 차', () => {
    expect(daysUntil('2026-10-20T14:00:00Z', now)).toBe(7); // KST 10-20 23:00
    expect(daysUntil('2026-10-20T15:00:00Z', now)).toBe(8); // KST 10-21 00:00
  });
  test('오늘 종료 → 0, 지남 → 0', () => {
    expect(daysUntil('2026-10-13T10:00:00Z', now)).toBe(0);
    expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('pnlTone', () => {
  test('양수 up · 음수 down · 0/없음 neutral', () => {
    expect(pnlTone(1)).toBe('up');
    expect(pnlTone(-0.1)).toBe('down');
    expect(pnlTone(0)).toBe('neutral');
    expect(pnlTone(null)).toBe('neutral');
    expect(pnlTone(undefined)).toBe('neutral');
  });
});

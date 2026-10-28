import { describe, test, expect } from 'vitest'
import {
  daysUntil,
  formatAmount,
  formatKrw,
  formatPct,
  formatPrice,
  formatSignedKrw,
  kstDateString,
  pnlClass,
} from './format'

// 앱 format 테스트 3개(game/lib/format · ui/format · market/format)를 웹 format.ts 하나로 합침.
// 웹 format.ts 에 있는 함수만 넣었다(앱 ui formatWon/formatSignedWon → 웹 formatKrw/formatSignedKrw,
// 앱 game pnlTone → 웹 pnlClass). 앱과 달랐던 반올림 4건(가격·음수 퍼센트·1만억·-0원)은 앱에 맞춰 고쳤다(2026-10-28).

describe('formatPrice', () => {
  test('천단위 콤마', () => {
    expect(formatPrice(71200)).toBe('71,200')
    expect(formatPrice(1234568)).toBe('1,234,568')
  })
  test('원 단위 반올림(앱과 같음), -0 없음', () => {
    expect(formatPrice(1234567.6)).toBe('1,234,568')
    expect(formatPrice(-0.4)).toBe('0')
  })
})

describe('kstDateString', () => {
  test('UTC 15:00 이후는 KST 다음 날', () => {
    expect(kstDateString(new Date('2026-10-13T15:00:00Z'))).toBe('2026-10-14')
  })
  test('UTC 14:59 는 KST 같은 날', () => {
    expect(kstDateString(new Date('2026-10-13T14:59:59Z'))).toBe('2026-10-13')
  })
})

describe('daysUntil', () => {
  const now = new Date('2026-10-13T01:00:00Z') // KST 10-13 10:00
  test('end 없음 → null', () => {
    expect(daysUntil(null, now)).toBeNull()
  })
  test('KST 날짜 차', () => {
    expect(daysUntil('2026-10-20T14:00:00Z', now)).toBe(7) // KST 10-20 23:00
    expect(daysUntil('2026-10-20T15:00:00Z', now)).toBe(8) // KST 10-21 00:00
  })
  test('오늘 종료 → 0, 지남 → 0', () => {
    expect(daysUntil('2026-10-13T10:00:00Z', now)).toBe(0)
    expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0)
  })
})

describe('pnlClass (앱 pnlTone)', () => {
  test('양수 up · 음수 down · 없음 기본색', () => {
    expect(pnlClass(1)).toBe('text-up')
    expect(pnlClass(-0.1)).toBe('text-down')
    expect(pnlClass(null)).toBe('text-ink')
    expect(pnlClass(undefined)).toBe('text-ink')
  })
  test('0 과 소수 1자리 반올림이 0 인 값은 회색(웹만 — 화면의 0.0%·₩0 과 색을 맞춤)', () => {
    expect(pnlClass(0)).toBe('text-ink-muted')
    expect(pnlClass(0.04)).toBe('text-ink-muted')
  })
})

describe('formatKrw (앱 ui formatWon)', () => {
  test('천단위 콤마 + 원화 기호', () => {
    expect(formatKrw(12450000)).toBe('₩12,450,000')
  })
  test('0', () => {
    expect(formatKrw(0)).toBe('₩0')
  })
})

describe('formatSignedKrw (앱 ui formatSignedWon)', () => {
  test('양수는 + 부호', () => {
    expect(formatSignedKrw(180000)).toBe('+₩180,000')
  })
  test('음수는 - 부호(절대값 표기)', () => {
    expect(formatSignedKrw(-42000)).toBe('-₩42,000')
  })
  test('0은 부호 없음', () => {
    expect(formatSignedKrw(0)).toBe('₩0')
  })
})

describe('formatPct', () => {
  test('양수 + 부호, 소수 1자리', () => {
    expect(formatPct(14.4)).toBe('+14.4%')
  })
  test('음수', () => {
    expect(formatPct(-3.26)).toBe('-3.3%')
  })
  test('0', () => {
    expect(formatPct(0)).toBe('0.0%')
  })
  test('음수 .x5 는 0 에서 멀어지게(앱과 같음)', () => {
    expect(formatPct(-3.25)).toBe('-3.3%')
    expect(formatPct(-0.05)).toBe('-0.1%')
    expect(formatPct(-0.04)).toBe('0.0%')
  })
})

describe('formatAmount (앱 market formatAmount)', () => {
  test('금액은 조·억으로 줄이고 그 아래는 원', () => {
    expect(formatAmount(1_234_000_000_000)).toBe('1.2조')
    expect(formatAmount(345_600_000_000)).toBe('3,456억')
    expect(formatAmount(98_765)).toBe('98,765원')
  })
  test('억으로 반올림해 1만억이 되면 조로(앱과 같음)', () => {
    expect(formatAmount(999_960_000_000)).toBe('1.0조')
    expect(formatAmount(999_940_000_000)).toBe('9,999억')
  })
  test('반올림해 0 이 되는 음수는 0원(앱과 같음)', () => {
    expect(formatAmount(-0.4)).toBe('0원')
  })
})

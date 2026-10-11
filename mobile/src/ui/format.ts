/** 금액/퍼센트 표기 순수 함수. 숫자는 또렷하게, 부호/색은 호출부(AmountText)에서. */

const won = (abs: number): string => `₩${Math.round(abs).toLocaleString('en-US')}`;

/** 부호 없는 원화. 예: 12450000 → "₩12,450,000" */
export function formatWon(value: number): string {
  return won(Math.abs(value));
}

/** 부호 있는 원화. 예: 180000 → "+₩180,000", -42000 → "-₩42,000", 0 → "₩0" */
export function formatSignedWon(value: number): string {
  if (value === 0) return won(0);
  const sign = value > 0 ? '+' : '-';
  return `${sign}${won(Math.abs(value))}`;
}

/** 부호 있는 퍼센트(소수 1자리). 예: 14.4 → "+14.4%", -3.25 → "-3.3%", 0 → "0.0%" */
export function formatPct(value: number): string {
  const fixed = Math.abs(value).toFixed(1);
  if (value === 0) return `0.0%`;
  const sign = value > 0 ? '+' : '-';
  return `${sign}${fixed}%`;
}

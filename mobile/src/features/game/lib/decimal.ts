// pydantic Decimal(JSON 문자열) 또는 number → 유한 number. (web lib/decimal.ts 와 동일)

/** 변환 불가(빈 문자열·NaN·Infinity·그 외 타입)면 null */
export function toNumOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 필수 숫자 필드용 — 변환 불가면 예외(조용한 NaN 표시 방지) */
export function toNum(v: unknown): number {
  const n = toNumOrNull(v);
  if (n === null) throw new Error(`숫자 변환 실패: ${String(v)}`);
  return n;
}

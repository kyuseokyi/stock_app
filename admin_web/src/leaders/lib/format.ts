// web_client/src/lib/format.ts 복사본 — 원본과 같이 고칠 것 (주도주 화면이 쓰는 formatPct·formatPrice·kstDateString 만)
// 표시용 순수 포맷 함수(퍼센트·가격·KST 날짜).

const KRW = new Intl.NumberFormat('ko-KR')
const KST_OFFSET_MS = 9 * 3_600_000

/** 원 단위 반올림, -0 은 0 으로('-0원' 방지) */
const round0 = (n: number): number => Math.round(n) || 0
/** 소수 한 자리 반올림(0 기준 대칭: -0.05 → -0.1, -3.25 → -3.3), -0 은 0 으로 — 앱 market/format round1 과 같음 */
const round1 = (n: number): number => (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10 || 0

/** 부호 포함 퍼센트(소수 1자리): +14.4% / -3.0% / 0.0% (반올림 후 0이면 부호 없음) */
export const formatPct = (n: number): string => {
  const r = round1(n)
  if (r === 0) return '0.0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}

/** 가격(원 단위 반올림 + 콤마): 71200 → '71,200', 1234567.6 → '1,234,568' */
export const formatPrice = (n: number): string => KRW.format(round0(n))

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

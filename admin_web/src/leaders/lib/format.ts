// web_client/src/lib/format.ts 복사본 — 원본과 같이 고칠 것 (주도주 화면이 쓰는 formatPct·formatPrice·kstDateString + 조건검색 formatWon·formatAmount·pnlClass)
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

/** 원화(원 단위 반올림 + 콤마 + '원'): 1234 → '1,234원' */
export const formatWon = (n: number): string => `${KRW.format(round0(n))}원`

/** 금액 축약: 1억 미만은 원, 1억 이상은 억, 1조 이상은 조(소수 1자리) */
export const formatAmount = (won: number): string => {
  // 억으로 반올림해 1만억(=1조)에 닿으면 조로 넘긴다 — '10,000억' 대신 '1.0조'
  if (Math.abs(Math.round(won / 1e8)) >= 10_000) return `${(won / 1e12).toFixed(1)}조`
  if (Math.abs(won) >= 1e8) return `${KRW.format(round0(won / 1e8))}억`
  return formatWon(won)
}

/** 등락 색 — 상승 핑크·하락 블루·0(반올림 기준) 회색·값 없음 기본 */
export const pnlClass = (n: number | null | undefined): string => {
  if (n == null) return 'text-ink'
  const r = round1(n)
  return r === 0 ? 'text-ink-muted' : r > 0 ? 'text-up' : 'text-down'
}

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

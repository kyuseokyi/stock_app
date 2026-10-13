// 표시용 순수 포맷 함수(원화·퍼센트·KST 날짜·D-day·손익 색).

const KRW = new Intl.NumberFormat('ko-KR')
const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

/** 12450000.4 → '₩12,450,000' (원 단위 반올림) */
export const formatKrw = (n: number): string => `₩${KRW.format(Math.round(n))}`

/** 부호 포함 원화: +₩180,000 / -₩5,000 / ₩0 */
export const formatSignedKrw = (n: number): string => {
  const r = Math.round(n)
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${formatKrw(Math.abs(r))}`
}

/** 부호 포함 퍼센트(소수 1자리): +14.4% / -3.0% / 0.0% (반올림 후 0이면 부호 없음) */
export const formatPct = (n: number): string => {
  const r = Math.round(n * 10) / 10
  if (r === 0) return '0.0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}

/** 가격(원 단위 콤마): 71200 → '71,200' */
export const formatPrice = (n: number): string => KRW.format(n)

/** 손익 색: 양수 빨강(up) / 음수 파랑(down) / 0·없음 기본 */
export const pnlClass = (n: number | null | undefined): string =>
  n == null || n === 0 ? 'text-ink' : n > 0 ? 'text-up' : 'text-down'

/** KST 기준 날짜 'YYYY-MM-DD' */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 종료 시각까지 남은 일수(KST 날짜 차). end 없음 → null, 지남 → 0 */
export function daysUntil(endIso: string | null, now: Date = new Date()): number | null {
  if (!endIso) return null
  const end = Date.parse(kstDateString(new Date(endIso)))
  const today = Date.parse(kstDateString(now))
  return Math.max(0, Math.round((end - today) / DAY_MS))
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** ISO 시각 → KST "10/12(월) 09:00" (브라우저 시간대 무관) */
export function formatKstShort(iso: string): string {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW[d.getUTCDay()]}) ${hh}:${mm}`
}

/** 주간 기간 "10/12(월) 09:00 ~ 10/19(월) 09:00" */
export const formatWeekRange = (startIso: string, endIso: string): string =>
  `${formatKstShort(startIso)} ~ ${formatKstShort(endIso)}`

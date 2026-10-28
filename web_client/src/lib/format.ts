// 표시용 순수 포맷 함수(원화·퍼센트·KST 날짜·D-day·손익 색).

const KRW = new Intl.NumberFormat('ko-KR')
const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

/** 원 단위 반올림, -0 은 0 으로('-0원' 방지) */
const round0 = (n: number): number => Math.round(n) || 0
/** 소수 한 자리 반올림(0 기준 대칭: -0.05 → -0.1, -3.25 → -3.3), -0 은 0 으로 — 앱 market/format round1 과 같음 */
const round1 = (n: number): number => (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10 || 0

/** 12450000.4 → '₩12,450,000' (원 단위 반올림) */
export const formatKrw = (n: number): string => `₩${KRW.format(round0(n))}`

/** 500000 → '500,000원' (주간 보상 표기 — 지난주 Top 3·토스트 공통) */
export const formatWon = (n: number): string => `${KRW.format(round0(n))}원`

/** 부호 포함 원화: +₩180,000 / -₩5,000 / ₩0 */
export const formatSignedKrw = (n: number): string => {
  const r = round0(n)
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${formatKrw(Math.abs(r))}`
}

/** 부호 포함 퍼센트(소수 1자리): +14.4% / -3.0% / 0.0% (반올림 후 0이면 부호 없음) */
export const formatPct = (n: number): string => {
  const r = round1(n)
  if (r === 0) return '0.0%'
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}

/** 큰 금액(원) → 조·억: 1_234_000_000_000 → '1.2조', 345_600_000_000 → '3,456억', 그 아래는 원 */
export const formatAmount = (won: number): string => {
  // 억으로 반올림해 1만억(=1조)에 닿으면 조로 넘긴다 — '10,000억' 대신 '1.0조'
  if (Math.abs(Math.round(won / 1e8)) >= 10_000) return `${(won / 1e12).toFixed(1)}조`
  if (Math.abs(won) >= 1e8) return `${KRW.format(round0(won / 1e8))}억`
  return formatWon(won)
}

/** 가격(원 단위 반올림 + 콤마): 71200 → '71,200', 1234567.6 → '1,234,568' */
export const formatPrice = (n: number): string => KRW.format(round0(n))

/** 손익 색: 양수 핑크레드(up) / 음수 블루(down) / 없음 기본 / 화면에 0으로 보이는 값(소수 1자리 반올림 0 — 0.0%·₩0)은 회색 */
export const pnlClass = (n: number | null | undefined): string => {
  if (n == null) return 'text-ink'
  const r = round1(n)
  return r === 0 ? 'text-ink-muted' : r > 0 ? 'text-up' : 'text-down'
}

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

/** 1~3위 보상 안내: [500000, 300000, 200000] → '500,000원·300,000원·200,000원' */
export const formatRewardTiers = (amounts: number[]): string => amounts.map(formatWon).join('·')

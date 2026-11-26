import type { TimeSlot } from '../api/dailySurge'

// 급등락·테마 분석 화면 표시 함수(순수) — 숫자·색·배지 문구.

/** +16.40% / -20.00% */
export const fmtRate = (r: number): string => `${r > 0 ? '+' : ''}${r.toFixed(2)}%`

/** 14,200원 */
export const fmtPrice = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`

/** +2,000 / -4,600 */
export const fmtDiff = (n: number): string => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ko-KR')}`

/** 원 → 억 원(1억 미만은 0.x억, 1조 이상은 조 단위) */
export function fmtValue(won: number): string {
  const eok = won / 1e8
  if (eok >= 10000) return `${(eok / 10000).toFixed(2)}조`
  if (eok >= 1) return `${Math.round(eok).toLocaleString('ko-KR')}억`
  return `${eok.toFixed(1)}억`
}

/** 1,530만주 / 4,821주 */
export function fmtVolume(v: number): string {
  if (v >= 10000) return `${Math.round(v / 10000).toLocaleString('ko-KR')}만주`
  return `${v.toLocaleString('ko-KR')}주`
}

/** 상승 = up(핑크레드), 하락 = down(블루) — 한국 증시 관례 */
export const rateClass = (r: number): string => (r > 0 ? 'text-up' : r < 0 ? 'text-down' : 'text-ink-muted')

export const SLOT_LABEL: Record<TimeSlot, string> = { pre: '장전', intra: '장중', post: '장후', other: '다른 날' }

export const SLOT_CLASS: Record<TimeSlot, string> = {
  pre: 'bg-danger-soft text-danger',
  intra: 'bg-up-soft text-up',
  post: 'bg-down-soft text-down',
  other: 'bg-fill text-ink-muted',
}

/** 발행 시각 "11. 26. 08:12"(KST) — 없으면 빈 문자열 */
export function slotTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** 소속 테마 이름 — KIS 보충 테마는 '(KIS)' 를 붙인다 */
export const themeLabel = (t: { name: string; source?: string | null }): string =>
  t.source === 'kis' ? `${t.name}(KIS)` : t.name

export const THEME_SOURCE_LABEL: Record<string, string> = {
  kiwoom: '키움',
  kis: 'KIS(키움 스냅숏 없음)',
  admin: '관리자',
  none: '테마 조회 실패',
}

/** YYYY-MM-DD 의 요일(한 글자) */
export function weekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? '' : ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()]
}

// 시장 숫자 표시 — 등락은 % 값(3.2 = +3.2%), 거래대금은 원. 한국식 색(상승 빨강·하락 파랑).

export const formatAmount = (won: number | null | undefined): string => {
  if (won == null) return '—'
  if (won >= 1e12) return `${(won / 1e12).toFixed(1)}조`
  if (won >= 1e8) return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억`
  return `${Math.round(won).toLocaleString('ko-KR')}원`
}

export const formatPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

export const pctClass = (v: number | null | undefined): string =>
  v == null ? 'text-slate-400' : v > 0 ? 'text-red-600' : v < 0 ? 'text-blue-600' : 'text-slate-600'

export const formatDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—'

export const formatSeconds = (s: number): string =>
  s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`

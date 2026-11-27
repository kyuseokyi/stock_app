import type {
  Confidence, ImpactGrade, Regime, Signal, SplitCut, Verdict,
} from '../api/aiLab'
import { CAPITAL_MAX, CAPITAL_MIN, RISK_MAX, RISK_MIN } from '../api/aiLab'
import { apiErrorDetail, apiErrorMessage } from './apiError'

// AI Lab 화면 표시 함수(순수) — 라벨·색·숫자 문구·오류 문구. 화면 부품은 여기서만 문구를 가져다 쓴다.

export const VERDICT_LABEL: Record<Verdict, string> = {
  STRONG_SETUP: '강한 셋업',
  WATCH_PULLBACK: '눌림 관찰',
  HOLD_WAIT: '보류·대기',
  AVOID_RISK: '위험 회피',
}

export const VERDICT_CLASS: Record<Verdict, string> = {
  STRONG_SETUP: 'bg-up-soft text-up',
  WATCH_PULLBACK: 'bg-brand-soft text-brand-strong',
  HOLD_WAIT: 'bg-fill text-ink-muted',
  AVOID_RISK: 'bg-danger-soft text-danger',
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  STRENGTHEN: '강화',
  MAINTAIN: '유지',
  WEAKEN: '약화',
  FALSIFY: '기각',
}

export const SIGNAL_CLASS: Record<Signal, string> = {
  STRENGTHEN: 'bg-up-soft text-up',
  MAINTAIN: 'bg-fill text-ink',
  WEAKEN: 'bg-down-soft text-down',
  FALSIFY: 'bg-danger-soft text-danger',
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { HIGH: '높음', MEDIUM: '보통', LOW: '낮음' }

export const IMPACT_LABEL: Record<ImpactGrade, string> = {
  regulation: '규제·정책',
  deal_funding: '수주·M&A·자금',
  tech: '기술·특허',
  earnings: '실적·업황',
  general: '일반',
}

export const REGIME_LABEL: Record<Regime, string> = { BULL: '상승장', CHOPPY: '횡보장', BEAR: '하락장' }

export const REGIME_CLASS: Record<Regime, string> = {
  BULL: 'bg-up-soft text-up',
  CHOPPY: 'bg-fill text-ink',
  BEAR: 'bg-down-soft text-down',
}

export const SCENARIO_LABEL = { bull: '낙관', base: '기본', bear: '비관' } as const

/** 라벨 표(Record)에 없는 값이 오면 원문 그대로 — 서버가 값을 늘려도 화면이 깨지지 않게 */
export const labelOf = <K extends string>(table: Record<K, string>, v: string | null | undefined): string =>
  v == null ? '-' : (table as Record<string, string>)[v] ?? v

export const classOf = <K extends string>(table: Record<K, string>, v: string | null | undefined): string =>
  (v != null && (table as Record<string, string>)[v]) || 'bg-fill text-ink-muted'

// ---------------------------------------------------------------- 숫자
/** 71,500원 (없으면 -) */
export const won = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '-' : `${Math.round(n).toLocaleString('ko-KR')}원`

/** +6.80% / -4.10% (없으면 -) */
export const pct = (n: number | null | undefined, digits = 2): string =>
  n == null || !Number.isFinite(n) ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`

/** 부호 없는 비율 61.0% (없으면 -) */
export const ratioPct = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? '-' : `${n.toFixed(digits)}%`

/** 배수 19.8배 (없으면 -) */
export const times = (n: number | null | undefined, digits = 1): string =>
  n == null || !Number.isFinite(n) ? '-' : `${n.toFixed(digits)}배`

/** 원 → 억(1조 이상은 조) */
export function eok(wonValue: number | null | undefined): string {
  if (wonValue == null || !Number.isFinite(wonValue)) return '-'
  const e = wonValue / 1e8
  if (Math.abs(e) >= 10000) return `${(e / 10000).toFixed(2)}조`
  if (Math.abs(e) >= 1) return `${Math.round(e).toLocaleString('ko-KR')}억`
  return `${e.toFixed(1)}억`
}

/** 상승 = up, 하락 = down(한국 증시 관례) */
export const signClass = (n: number | null | undefined): string =>
  n == null ? 'text-ink-muted' : n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-ink-muted'

/** 별점 ★★★☆☆ (1~5 로 자름) */
export function stars(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)))
  return '★'.repeat(k) + '☆'.repeat(5 - k)
}

/** 감성 점수 +0.82 / -0.40 */
export const sentiment = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(2)}`

/** SEPA 조건 결과 */
export const passLabel = (p: boolean | null): string => (p === true ? '통과' : p === false ? '실패' : '자료 부족')
export const passClass = (p: boolean | null): string =>
  p === true ? 'bg-up-soft text-up' : p === false ? 'bg-down-soft text-down' : 'bg-fill text-ink-muted'

/** 'YYYY-MM-DD' 또는 'YYYYMMDD' → 'M월 D일' */
export function monthDay(d: string | null | undefined): string {
  if (!d) return '-'
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(d)
  if (!m) return d
  return `${Number(m[2])}월 ${Number(m[3])}일`
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'(이미 대시면 그대로) */
export function isoDay(d: string | null | undefined): string {
  if (!d) return '-'
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(d)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : d
}

/** ISO 시각 → 'YYYY-MM-DD HH:mm'(KST) */
export function kstDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  // 시간대 없는 값은 UTC 로 본다(서버 now() 기준)
  const t = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(t.getTime())) return iso
  return new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')
}

/** 분할·병합 의심 경고 — "3월 4일 이전 일봉은 분할·병합 의심으로 제외" */
export const splitCutMessage = (s: SplitCut): string =>
  `${monthDay(s.date)} 이전 일봉 ${s.dropped.toLocaleString('ko-KR')}개는 분할·병합 의심으로 제외했습니다` +
  `${s.jump_pct != null ? ` (그날 종가 변동 ${pct(s.jump_pct, 1)})` : ''}.`

/** 3줄 요약 — 리포트는 줄바꿈으로 이은 문자열 */
export const summaryLines = (s: string | null | undefined): string[] =>
  (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean)

// ---------------------------------------------------------------- 입력
/** 자본(원) 입력값 → 서버 허용 범위 안의 숫자(숫자가 아니면 null) */
export function parseCapital(raw: string): number | null {
  const n = Number(raw.replace(/[,\s원]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(CAPITAL_MAX, Math.max(CAPITAL_MIN, Math.round(n)))
}

/** 리스크% 입력값 → 0.1~5.0 (숫자가 아니면 null) */
export function parseRisk(raw: string): number | null {
  const n = Number(raw.replace(/[%\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(RISK_MAX, Math.max(RISK_MIN, Math.round(n * 100) / 100))
}

/** 6자리 국내 종목코드 */
export const TICKER_RE = /^[0-9A-Za-z]{6}$/

/** 스킬 선택 → 서버 파라미터. 전부 골랐으면 undefined(=전체), 하나도 안 골랐으면 null(분석 불가) */
export function skillsParam(selected: string[], all: string[]): string[] | undefined | null {
  if (selected.length === 0) return null
  if (all.length > 0 && all.every((id) => selected.includes(id))) return undefined
  return all.length ? all.filter((id) => selected.includes(id)) : selected
}

// ---------------------------------------------------------------- 오류
/** AI 분석·조회 오류 → 화면 문구(서버 code 기준). 502 는 거부 사유(reason)도 붙인다. */
export function analyzeErrorMessage(e: unknown): string {
  const d = apiErrorDetail(e)
  const code = typeof d?.code === 'string' ? d.code : null
  const reason = typeof d?.reason === 'string' ? d.reason : null
  switch (code) {
    case 'GEMINI_UNAVAILABLE':
      return 'Gemini 키 미설정 — AI 분석을 할 수 없습니다(정량 미리 보기는 됩니다).'
    case 'AI_RESPONSE_INVALID':
      return `AI 응답 검증 실패, 저장 안 함${reason ? ` (사유: ${reason})` : ''}`
    case 'ANALYZING':
      return '분석 중 — 이 종목을 다른 곳에서 분석하고 있습니다. 잠시 뒤 다시 시도하세요.'
    case 'NOT_FOUND':
      return '종목 없음 — 일봉 자료가 없는 종목입니다.'
    case 'UNKNOWN_SKILL':
      return `알 수 없는 스킬이 있습니다${typeof d?.message === 'string' ? ` (${d.message})` : ''}.`
    default:
      return apiErrorMessage(e)
  }
}

/** 일괄 분석 오류 → 문구 */
export function batchErrorMessage(e: unknown): string {
  const code = apiErrorDetail(e)?.code
  if (code === 'ALREADY_RUNNING') return '이미 진행 중 — 일괄 분석이 돌고 있습니다. 끝난 뒤 다시 시도하세요.'
  return apiErrorMessage(e)
}

/** 응답 상태 코드(없으면 null) */
export const httpStatus = (e: unknown): number | null =>
  (e as { response?: { status?: number } })?.response?.status ?? null

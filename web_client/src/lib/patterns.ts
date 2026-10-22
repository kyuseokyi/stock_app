// 차트 패턴 화면용 순수 함수 — 리포트·패턴·정렬 상수와 한국어 라벨, 단계 표기, 숫자 포맷.
import { formatPct, formatPrice } from './format'
import type { MarketFilter } from '../types/screener'
import type { PatternKind, PatternPoint, PatternReport, PatternSort } from '../types/patterns'

/** 한 번에 받는 개수(서버 MAX_LIMIT 이하) */
export const PATTERN_PAGE = 50

export const PATTERN_REPORTS: { key: PatternReport; label: string; description: string }[] = [
  { key: 'forming', label: '형성 중', description: '아직 피벗을 돌파하지 않고 베이스를 만들고 있는 종목' },
  { key: 'near_pivot', label: '피벗 근접', description: '종가가 피벗(돌파 기준가) 가까이 올라온 종목' },
  { key: 'breakout_today', label: '오늘 돌파', description: '오늘 피벗을 돌파한 종목' },
  { key: 'recent_breakouts', label: '최근 돌파 20일', description: '최근 20거래일 안에 피벗을 돌파한 종목' },
]

export const PATTERN_KINDS: { key: PatternKind | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'cup', label: '컵' },
  { key: 'cup_with_handle', label: '컵핸들' },
  { key: 'double_bottom', label: '쌍바닥' },
  { key: 'flat_base', label: '플랫 베이스' },
  { key: 'consolidation', label: '박스권' },
  { key: 'htf', label: '하이 타이트 플래그(HTF)' },
]

export const PATTERN_SORTS: { key: PatternSort; label: string }[] = [
  { key: 'pivot_dist', label: '피벗 근접순' },
  { key: 'breakout_vol', label: '돌파 거래량' },
  { key: 'depth', label: '깊이' },
  { key: 'length', label: '길이' },
]

export const PATTERN_MARKETS: { key: MarketFilter; label: string }[] = [
  { key: 'ALL', label: '전체 시장' },
  { key: 'KOSPI', label: '코스피' },
  { key: 'KOSDAQ', label: '코스닥' },
]

export function patternLabel(type: string): string {
  return PATTERN_KINDS.find((k) => k.key === type)?.label ?? type
}

/** stage 2 · label "2b" → '2단계 · 2b', label 이 단계 숫자뿐이면 '1단계' */
export function stageLabel(stage: number, label: string): string {
  return label && label !== String(stage) ? `${stage}단계 · ${label}` : `${stage}단계`
}

const fixed = (n: number | null, digits = 1, suffix = '%') => (n === null ? '–' : `${n.toFixed(digits)}${suffix}`)

/** 피벗까지 %: 종가/피벗-1 — 음수면 아직 피벗 아래 */
export const pivotDistText = (n: number | null): string => (n === null ? '–' : formatPct(n))
export const depthText = (n: number): string => fixed(n)
export const lengthText = (n: number): string => `${n}일`
export const pivotText = (n: number): string => formatPrice(n)
export const volText = (n: number | null): string => (n === null ? '–' : `+${Math.round(n)}%`)

/** 돌파 정보 한 줄: '10-13 돌파 (3일 전) · 거래량 +120%' / 돌파 전이면 null */
export function breakoutText(date: string | null, days: number | null, volPct: number | null): string | null {
  if (!date) return null
  const ago = days === null ? '' : days === 0 ? ' (오늘)' : ` (${days}일 전)`
  const vol = volPct === null ? '' : ` · 거래량 ${volText(volPct)}`
  return `${date.slice(5)} 돌파${ago}${vol}`
}

/** 차트 마커 — 엔진 points 의 role 별 모양·글자·색(색은 호출 쪽에서 테마로 채움) */
export const POINT_STYLE: Record<string, { text: string; position: 'aboveBar' | 'belowBar'; shape: 'circle' | 'arrowUp' | 'arrowDown' | 'square' }> = {
  rim: { text: '림', position: 'aboveBar', shape: 'arrowDown' },
  base: { text: '저점', position: 'belowBar', shape: 'arrowUp' },
  base1: { text: '저점1', position: 'belowBar', shape: 'arrowUp' },
  base2: { text: '저점2', position: 'belowBar', shape: 'arrowUp' },
  mid_peak: { text: '중간 고점', position: 'aboveBar', shape: 'circle' },
  handle: { text: '핸들', position: 'aboveBar', shape: 'circle' },
  pole: { text: '깃대', position: 'belowBar', shape: 'square' },
  pivot: { text: '피벗', position: 'aboveBar', shape: 'square' },
  end: { text: '우측 림', position: 'aboveBar', shape: 'circle' },
}

export function pointMarker(p: PatternPoint, color: string) {
  const s = POINT_STYLE[p.role]
  if (!s || !p.date) return null
  return { date: p.date, position: s.position, shape: s.shape, color, text: s.text }
}

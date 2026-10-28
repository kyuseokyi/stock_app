// web_client/src/lib/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 화면이 쓰는 패턴 이름·피벗 거리 표기·차트 마커)
// 차트 패턴 화면용 순수 함수 — 패턴 한국어 라벨, 숫자 포맷.
import { formatPct } from './format'
import type { PatternKind, PatternPoint } from '../types/patterns'

export const PATTERN_KINDS: { key: PatternKind | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'cup', label: '컵' },
  { key: 'cup_with_handle', label: '컵핸들' },
  { key: 'double_bottom', label: '쌍바닥' },
  { key: 'flat_base', label: '플랫 베이스' },
  { key: 'consolidation', label: '박스권' },
  { key: 'htf', label: '하이 타이트 플래그(HTF)' },
]

export function patternLabel(type: string): string {
  return PATTERN_KINDS.find((k) => k.key === type)?.label ?? type
}

/** 피벗까지 %: 종가/피벗-1 — 음수면 아직 피벗 아래 */
export const pivotDistText = (n: number | null): string => (n === null ? '–' : formatPct(n))

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

// 컵핸들만 지점 뜻이 다르다(엔진 cup_with_handle.py): handle = 손잡이 시작 고점(오른쪽 림·피벗), end = 손잡이 저점.
// 다른 패턴의 end 는 오른쪽 고점이라 '우측 림'이 맞다. 그대로 두면 컵핸들에서 두 글자가 같은 위쪽에 겹치고 뜻도 뒤바뀐다
const CUP_HANDLE_STYLE: Record<string, (typeof POINT_STYLE)[string]> = {
  handle: { text: '우측 림', position: 'aboveBar', shape: 'circle' },
  end: { text: '핸들 저점', position: 'belowBar', shape: 'arrowUp' },
}

export function pointMarker(p: PatternPoint, color: string, patternType?: string) {
  const s = (patternType === 'cup_with_handle' ? CUP_HANDLE_STYLE[p.role] : undefined) ?? POINT_STYLE[p.role]
  if (!s || !p.date) return null
  return { date: p.date, position: s.position, shape: s.shape, color, text: s.text }
}

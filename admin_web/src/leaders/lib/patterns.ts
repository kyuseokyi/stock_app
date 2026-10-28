// web_client/src/lib/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 화면이 쓰는 패턴 이름·피벗 거리 표기만)
// 차트 패턴 화면용 순수 함수 — 패턴 한국어 라벨, 숫자 포맷.
import { formatPct } from './format'
import type { PatternKind } from '../types/patterns'

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

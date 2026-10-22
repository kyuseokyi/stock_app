// 차트 패턴 순수 함수 — 라벨·필터 비교·현재 베이스 고르기·차트 선 만들기.
import { LEADERS_PAGE } from '@/features/leaders/canslim';
import type { ChartLine } from '@/features/game/lib/chart-bridge';

import type { PatternBase, PatternQuery, PatternReport, PatternType, PatternZones } from './types';

export const PATTERN_PAGE = LEADERS_PAGE;

export const REPORTS: { key: PatternReport; label: string; description: string }[] = [
  { key: 'forming', label: '형성 중', description: '아직 피벗(매수 기준가)을 넘지 않고 베이스를 만들고 있는 종목' },
  { key: 'near_pivot', label: '피벗 근접', description: '종가가 피벗의 90~105% 사이로 돌파를 앞둔 종목' },
  { key: 'breakout_today', label: '오늘 돌파', description: '기준일에 피벗을 돌파한 종목' },
  { key: 'recent_breakouts', label: '최근 돌파', description: '최근 20거래일 안에 피벗을 돌파한 종목' },
];

export const PATTERN_TYPES: { key: PatternType; label: string }[] = [
  { key: 'cup', label: '컵' },
  { key: 'cup_with_handle', label: '컵핸들' },
  { key: 'double_bottom', label: '쌍바닥' },
  { key: 'flat_base', label: '플랫 베이스' },
  { key: 'consolidation', label: '박스권' },
  { key: 'htf', label: 'HTF' },
];

export const INITIAL_PATTERN_QUERY: PatternQuery = { report: 'forming', patternType: null };

export function reportDescription(r: PatternReport): string {
  return REPORTS.find((x) => x.key === r)?.description ?? '';
}

/** 패턴 한국어 이름 — 모르는 값은 서버 label 이 아니라 원문을 그대로 */
export function patternLabel(type: string): string {
  return PATTERN_TYPES.find((p) => p.key === type)?.label ?? type;
}

/** 베이스 단계 표기 — 서버 label 이 '2a' 처럼 단계와 다르면 괄호로 덧붙인다 */
export function stageText(stage: number, label: string): string {
  return label && label !== String(stage) ? `${stage}단계 (${label})` : `${stage}단계`;
}

/** 같은 필터면 true — 같은 값 재조회를 막는다 */
export function samePatternQuery(a: PatternQuery, b: PatternQuery): boolean {
  return a.report === b.report && a.patternType === b.patternType;
}

/** 패턴 칩은 하나만 — 같은 것을 다시 누르면 전체로 */
export function togglePatternType(current: PatternType | null, t: PatternType): PatternType | null {
  return current === t ? null : t;
}

/** 상태 문구 — 돌파 전이면 '형성 중', 돌파했으면 '돌파 n일째'(날짜를 모르면 '돌파') */
export function breakoutText(isActive: boolean, daysSinceBreakout: number | null): string {
  if (isActive) return '형성 중';
  return daysSinceBreakout !== null ? `돌파 ${daysSinceBreakout}일째` : '돌파';
}

/** 피벗 대비 종가 거리(%) — 서버 pivotDistPct 와 같은 식. 입력이 비정상이면 null */
export function pivotDistPct(close: number | null, pivot: number): number | null {
  if (close === null || !Number.isFinite(close) || !Number.isFinite(pivot) || pivot <= 0) return null;
  return (close / pivot - 1) * 100;
}

/** 현재 베이스 — isCurrent 인 첫 베이스, 없으면 null(영역 숨김) */
export function currentBase(bases: PatternBase[] | null | undefined): PatternBase | null {
  return bases?.find((b) => b.isCurrent) ?? null;
}

export interface PatternLineColors {
  pivot: string;
  buy: string;
  stop: string;
}

/** 차트 선 — 피벗 실선(굵게), 매수 구간 상단·손절(하단 stopLow, 피벗 −8%) 점선. zones 가 없으면 피벗만 */
export function patternChartLines(pivot: number, zones: PatternZones | null, colors: PatternLineColors): ChartLine[] {
  if (!Number.isFinite(pivot)) return [];
  const lines: ChartLine[] = [{ price: pivot, color: colors.pivot, width: 2, dashed: false, title: '피벗', fit: 'day' }];
  if (zones) {
    if (Number.isFinite(zones.buyHigh)) {
      lines.push({ price: zones.buyHigh, color: colors.buy, width: 1, dashed: true, title: '매수 상단', fit: 'day' });
    }
    if (Number.isFinite(zones.stopLow)) {
      lines.push({ price: zones.stopLow, color: colors.stop, width: 1, dashed: true, title: '손절', fit: 'day' });
    }
  }
  return lines;
}

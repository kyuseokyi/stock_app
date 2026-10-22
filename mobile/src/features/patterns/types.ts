// 차트 패턴(stock_api GraphQL patternScreen·patternBases) 타입 — 백엔드 graphql/types.py 의 Pattern* 와 같다.

export type PatternReport = 'forming' | 'near_pivot' | 'breakout_today' | 'recent_breakouts';
export type PatternType = 'cup' | 'cup_with_handle' | 'double_bottom' | 'flat_base' | 'consolidation' | 'htf';

/** 목록 필터 — patternType null = 전체 패턴 */
export interface PatternQuery {
  report: PatternReport;
  patternType: PatternType | null;
}

export interface PatternItem {
  ticker: string;
  name: string;
  market: string;
  sectorName: string | null;
  close: number;
  patternType: string;
  label: string;
  stage: number;
  pivot: number;
  pivotDistPct: number | null; // (종가/피벗 - 1) × 100
  depth: number;
  length: number;
  isActive: boolean; // 돌파 전
  breakoutDate: string | null;
  breakoutPricePct: number | null;
  breakoutVolPct: number | null;
  daysSinceBreakout: number | null;
}

export interface PatternScreen {
  date: string | null; // null = 아직 계산된 날이 없음(준비 중)
  total: number;
  items: PatternItem[];
}

export interface PatternPoint {
  role: string;
  date: string | null;
  price: number | null;
}

export interface PatternBase {
  patternType: string;
  label: string;
  stage: number;
  subcount: number;
  totalcount: number;
  rimDate: string | null;
  lowDate: string | null;
  lowPrice: number | null;
  pivot: number;
  depth: number;
  length: number;
  isActive: boolean;
  isCurrent: boolean;
  breakoutDate: string | null;
  breakoutPricePct: number | null;
  breakoutVolPct: number | null;
  daysSinceBreakout: number | null;
  priorUptrendPct: number | null;
  confidence: number;
  points: PatternPoint[];
}

/** 매수·손절 구간 — 현재 베이스가 없거나 돌파 후 크게 벗어났으면 서버가 null */
export interface PatternZones {
  buyLow: number;
  buyHigh: number;
  stopLow: number;
  stopHigh: number;
}

export interface PatternBases {
  date: string | null;
  ticker: string;
  name: string;
  close: number | null;
  bases: PatternBase[];
  zones: PatternZones | null;
}

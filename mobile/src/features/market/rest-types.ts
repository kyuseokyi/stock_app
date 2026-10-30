// stock_api REST(/api/v1/market/*) 응답 타입 — 정규화(rest-normalize.ts)를 거친 뒤의 모양.
// 서버는 장애·키 없음에도 200 + 빈 값을 주므로 화면은 "비었음"만 처리하면 된다.

export interface SectorNote {
  sector: string;
  reason: string;
}

/** AI 장전 브리핑(매일 08:30) */
export interface MorningBrief {
  date: string;
  headline: string;
  usMarketSummary: string;
  krImpactSummary: string;
  bullishSectors: SectorNote[];
  bearishSectors: SectorNote[];
  macroCheckpoints: string[];
  createdAt: string | null;
}

export type Reliability = '상' | '중' | '하';

/** 급등·급락 종목 + AI 원인 */
export interface Mover {
  ticker: string;
  stockName: string;
  price: number | null;
  changeRate: number | null;
  reasonSummary: string | null;
  category: string | null;
  reliability: Reliability | null;
  riskWarning: string | null;
}

export interface HotKeyword {
  keyword: string;
  background: string;
  tickers: string[];
}

export interface Movers {
  updatedAt: string | null;
  gainers: Mover[];
  losers: Mover[];
  keywords: HotKeyword[];
}

export type FlowSource = 'pykrx' | 'kis';

export interface FlowItem {
  ticker: string;
  name: string;
  /** 순매수 금액(원) */
  netAmount: number;
}

export interface DoubleBuyItem {
  ticker: string;
  name: string;
  foreignAmount: number;
  institutionAmount: number;
}

/** 투자자별 수급 전광판 */
export interface InvestorFlow {
  date: string | null;
  source: FlowSource | null;
  foreignTop: FlowItem[];
  institutionTop: FlowItem[];
  pensionTop: FlowItem[];
  doubleBuy: DoubleBuyItem[];
  aiComment: string | null;
  updatedAt: string | null;
}

export type HeatmapKind = 'sector' | 'theme';
export type HeatmapSize = 'mcap' | 'value';

/** 히트맵 종목 칸 — ticker 가 '' 이면 "기타 N종목" 묶음 칸 */
export interface HeatmapStock {
  ticker: string;
  name: string;
  chg: number | null;
  size: number;
}

export interface HeatmapGroup {
  id: string;
  name: string;
  chg: number | null;
  size: number;
  stocks: HeatmapStock[];
}

export interface Heatmap {
  date: string | null;
  groups: HeatmapGroup[];
}

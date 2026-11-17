// stock_api REST(/api/v1/market/*) 응답 타입 — 정규화(rest-normalize.ts)를 거친 뒤의 모양.
// 서버는 장애·키 없음에도 200 + 빈 값을 주므로 화면은 "비었음"만 처리하면 된다.
import type { NewsSource } from '@/features/ai-sources/sources';

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
  /** 근거 기사(최대 3, 없으면 []) */
  sources: NewsSource[];
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
  /** 근거 기사(최대 3, 없으면 []) */
  sources: NewsSource[];
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

export type FlowSource = 'kiwoom' | 'pykrx' | 'kis';

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

/** 오늘 특징주 — 52주 신고가·신저가 종목 */
export interface FeaturedStock {
  ticker: string;
  name: string;
  market: string | null;
  close: number | null;
  /** 당일 등락률(%) */
  changeRate: number | null;
}

export interface FeaturedList {
  /** 전체 종목 수(목록은 상위 20까지만 옴) */
  count: number;
  items: FeaturedStock[];
}

export type ViDirection = 'up' | 'down';

/** VI(변동성완화장치) 발동 종목 — 같은 종목은 최근 발동 한 줄 + 횟수 */
export interface ViStock {
  ticker: string;
  name: string;
  /** 최근 발동 시각 'HH:MM:SS' */
  time: string;
  /** 정적·동적·동적+정적 */
  kind: string;
  direction: ViDirection | null;
  /** 발동가(원) */
  price: number | null;
  /** 괴리율(%) */
  rate: number | null;
  count: number;
}

export interface FeaturedVi {
  date: string | null;
  updatedAt: string | null;
  count: number;
  items: ViStock[];
}

/** GET /market/featured — vi 가 null 이면(키움 미연결·수집 전) VI 칸을 숨긴다 */
export interface Featured {
  /** 신고저가 기준 거래일(20:30 계산 — 장중에는 직전 거래일) */
  date: string | null;
  highs: FeaturedList;
  lows: FeaturedList;
  vi: FeaturedVi | null;
}

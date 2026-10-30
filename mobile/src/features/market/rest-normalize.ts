// REST 응답 정규화 — 순수 함수(네트워크·RN 의존 없음, 테스트 대상).
// 필드 누락·null·잘못된 타입을 막아 화면이 항상 같은 모양을 받게 한다. 숫자는 유한한 값만 통과.
import type {
  DoubleBuyItem,
  FlowItem,
  FlowSource,
  Heatmap,
  HeatmapGroup,
  HeatmapStock,
  HotKeyword,
  InvestorFlow,
  MorningBrief,
  Mover,
  Movers,
  Reliability,
  SectorNote,
} from './rest-types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** 문자열이면 앞뒤 공백을 뗀 값, 아니면 '' */
export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** 비어 있지 않은 문자열이면 그 값, 아니면 null */
export const strOrNull = (v: unknown): string | null => str(v) || null;
/** 유한한 숫자(숫자 문자열 포함)면 그 값, 아니면 null */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 목록 정규화 — 변환 결과가 null 인 항목은 버린다 */
function list<T>(v: unknown, fn: (x: Obj) => T | null): T[] {
  const out: T[] = [];
  for (const x of arr(v)) {
    if (!isObj(x)) continue;
    const r = fn(x);
    if (r != null) out.push(r);
  }
  return out;
}

const sectorNote = (x: Obj): SectorNote | null => {
  const sector = str(x.sector);
  return sector ? { sector, reason: str(x.reason) } : null;
};

/** GET /market/morning-brief → 브리핑(없거나 헤드라인이 비면 null) */
export function normalizeMorningBrief(raw: unknown): MorningBrief | null {
  const b = isObj(raw) ? raw.brief : null;
  if (!isObj(b)) return null;
  const headline = str(b.headline);
  if (!headline) return null;
  return {
    date: str(b.date),
    headline,
    usMarketSummary: str(b.us_market_summary),
    krImpactSummary: str(b.kr_impact_summary),
    bullishSectors: list(b.bullish_sectors, sectorNote),
    bearishSectors: list(b.bearish_sectors, sectorNote),
    macroCheckpoints: arr(b.macro_checkpoints).map(str).filter(Boolean),
    createdAt: strOrNull(b.created_at),
  };
}

const RELIABILITY: Reliability[] = ['상', '중', '하'];

const mover = (x: Obj): Mover | null => {
  const ticker = str(x.ticker);
  if (!ticker) return null;
  const rel = str(x.reliability);
  return {
    ticker,
    stockName: str(x.stock_name) || ticker,
    price: num(x.price),
    changeRate: num(x.change_rate),
    reasonSummary: strOrNull(x.reason_summary),
    category: strOrNull(x.category),
    reliability: (RELIABILITY as string[]).includes(rel) ? (rel as Reliability) : null,
    riskWarning: strOrNull(x.risk_warning),
  };
};

const keyword = (x: Obj): HotKeyword | null => {
  const k = str(x.keyword).replace(/^#+/, '');
  return k ? { keyword: k, background: str(x.background), tickers: arr(x.tickers).map(str).filter(Boolean) } : null;
};

/** GET /market/movers → 급등·급락(각 최대 10)·핫 키워드 */
export function normalizeMovers(raw: unknown): Movers {
  const r = isObj(raw) ? raw : {};
  return {
    updatedAt: strOrNull(r.updated_at),
    gainers: list(r.gainers, mover).slice(0, 10),
    losers: list(r.losers, mover).slice(0, 10),
    keywords: list(r.keywords, keyword),
  };
}

const flowItem = (x: Obj): FlowItem | null => {
  const ticker = str(x.ticker);
  const amount = num(x.net_amount);
  if (!ticker || amount == null) return null;
  return { ticker, name: str(x.name) || ticker, netAmount: amount };
};

const doubleBuy = (x: Obj): DoubleBuyItem | null => {
  const ticker = str(x.ticker);
  const f = num(x.foreign_amount);
  const i = num(x.institution_amount);
  if (!ticker || f == null || i == null) return null;
  return { ticker, name: str(x.name) || ticker, foreignAmount: f, institutionAmount: i };
};

const SOURCES: FlowSource[] = ['pykrx', 'kis'];

/** GET /market/investor-flow → 수급 전광판(각 Top 최대 10) */
export function normalizeInvestorFlow(raw: unknown): InvestorFlow {
  const r = isObj(raw) ? raw : {};
  const src = str(r.source);
  return {
    date: strOrNull(r.date),
    source: (SOURCES as string[]).includes(src) ? (src as FlowSource) : null,
    foreignTop: list(r.foreign_top, flowItem).slice(0, 10),
    institutionTop: list(r.institution_top, flowItem).slice(0, 10),
    pensionTop: list(r.pension_top, flowItem).slice(0, 10),
    doubleBuy: list(r.double_buy, doubleBuy),
    aiComment: strOrNull(r.ai_comment),
    updatedAt: strOrNull(r.updated_at),
  };
}

const heatStock = (x: Obj): HeatmapStock | null => {
  const size = num(x.size);
  const name = str(x.name);
  if (size == null || size <= 0 || !name) return null;
  return { ticker: str(x.ticker), name, chg: num(x.chg), size };
};

const heatGroup = (x: Obj): HeatmapGroup | null => {
  const id = str(x.id) || (typeof x.id === 'number' ? String(x.id) : '');
  const size = num(x.size);
  if (!id || size == null || size <= 0) return null;
  return { id, name: str(x.name) || id, chg: num(x.chg), size, stocks: list(x.stocks, heatStock) };
};

/** GET /market/heatmap → 그룹(크기 > 0 만)·종목 칸 */
export function normalizeHeatmap(raw: unknown): Heatmap {
  const r = isObj(raw) ? raw : {};
  return { date: strOrNull(r.date), groups: list(r.groups, heatGroup) };
}

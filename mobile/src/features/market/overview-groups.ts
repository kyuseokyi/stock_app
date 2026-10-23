// 시장 칩 묶음 — 지수·거시 지표를 국내 증시 / 밤사이 미국 증시 / 돈의 흐름 / 미국 경제지표로 나눈다(웹 '세계 시장' 탭과 같은 분류).
// 모바일 홈에는 시장 노트가 없어 국내 지수도 이 칩에 남긴다. 처음 보는 코드도 버리지 않고 가까운 묶음 끝에 붙인다.
import type { MacroValue, MarketIndex } from './types';

/** 미국 증시 순서(KIS 해외지수) — 목록에 없는 미국 코드는 뒤에 붙는다 */
export const US_ORDER = ['US:SPX', 'US:COMP', 'US:NDX', 'US:SOX', 'US:DJI'];
/** 돈의 흐름 — 원/달러·VIX(지수) + 미 국채 금리(FRED) */
export const FLOW_CODES = ['FX:USDKRW', 'US:VIX'];
export const RATE_SERIES = ['DGS10', 'DGS2'];
/** 매 영업일 관측되는 FRED 시리즈 — 카드에 월이 아니라 날짜로 표시 */
export const DAILY_SERIES = ['DGS10', 'DGS2', 'T10Y2Y'];
/** 오르는 게 좋은 일이 아닌 지표 — 상승 색 대신 회색에 부호, 뜻을 한 줄로(웹 MarketTab 과 같은 문구) */
export const NEUTRAL_HINT: Record<string, string> = {
  'FX:USDKRW': '오르면 원화 약세',
  'US:VIX': '공포지수 · 오르면 불안이 커졌다는 뜻',
};

export interface OverviewGroups {
  kr: MarketIndex[];
  us: MarketIndex[];
  flow: MarketIndex[];
  rates: MacroValue[];
  otherMacro: MacroValue[];
}

const orderBy = <T,>(items: T[], key: (t: T) => string, order: string[]): T[] =>
  [...items].sort((a, b) => {
    const ia = order.indexOf(key(a));
    const ib = order.indexOf(key(b));
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib);
  });

export function groupOverview(indices: MarketIndex[], macro: MacroValue[]): OverviewGroups {
  const kr = indices.filter((i) => i.region === 'KR');
  const flow = orderBy(
    indices.filter((i) => FLOW_CODES.includes(i.code) || (i.region !== 'KR' && i.region !== 'US')),
    (i) => i.code,
    FLOW_CODES,
  );
  const us = orderBy(
    indices.filter((i) => i.region === 'US' && !FLOW_CODES.includes(i.code)),
    (i) => i.code,
    US_ORDER,
  );
  const rates = orderBy(macro.filter((m) => RATE_SERIES.includes(m.seriesId)), (m) => m.seriesId, RATE_SERIES);
  const otherMacro = macro.filter((m) => !RATE_SERIES.includes(m.seriesId));
  return { kr, us, flow, rates, otherMacro };
}

// 차트 게임 지지·저항 = 지표 5개(매물대 POC·BB 상단·BB 하단·5일선·20일선 — 20일선 = BB 중심)(설계 2026-10-27 chart-game-sr-trendlines §8).
// 마지막 캔들 몸통(시가~종가, 꼬리 제외)이 닿은 지표에 차트 전체 폭 가로선을 긋는다.
// 웹 web_client/src/lib/touchLevels.ts 와 같은 코드.
import { bollinger, sma } from './indicators';
import { roundToTick } from './krx-tick';
import { srEps } from './sr-watch';

export interface IndicatorLevel {
  id: string; // 'poc' | 'ma5' | 'ma20' | 'bbUpper' | 'bbLower'
  name: string; // 범례·알림 이름
  price: number;
  color: string;
}

export const SR_MA5_COLOR = '#14b8a6';
export const SR_MA20_COLOR = '#f97316';
export const SR_BB_COLOR = 'rgba(99, 102, 241, 0.7)';
export const SR_POC_RESIST = '#f59e0b'; // POC 가 현재가 이상(매물대 점과 같은 색)
export const SR_POC_SUPPORT = '#8b5cf6';

/**
 * 게임 지지·저항 지표의 마지막 캔들 값 — 순서 POC → 5일선 → 20일선 → BB 상단 → BB 하단(같은 호가 가격이면 앞의 것이 남음).
 * POC 는 매물대가 켜져 있을 때만(null 이면 뺌). 기간이 모자라면 그 지표는 뺌
 */
export function srIndicatorLevels(closes: number[], poc: number | null): IndicatorLevel[] {
  const n = closes.length;
  if (n === 0) return [];
  const out: IndicatorLevel[] = [];
  if (poc !== null && Number.isFinite(poc) && poc > 0) {
    out.push({ id: 'poc', name: '매물대 POC', price: poc, color: poc >= closes[n - 1] ? SR_POC_RESIST : SR_POC_SUPPORT });
  }
  const ma5 = sma(closes, 5)[n - 1];
  if (ma5 !== null) out.push({ id: 'ma5', name: '5일선', price: ma5, color: SR_MA5_COLOR });
  const ma20 = sma(closes, 20)[n - 1];
  if (ma20 !== null) out.push({ id: 'ma20', name: '20일선', price: ma20, color: SR_MA20_COLOR });
  const b = bollinger(closes)[n - 1];
  if (b !== null) {
    out.push({ id: 'bbUpper', name: 'BB 상단', price: b.upper, color: SR_BB_COLOR });
    out.push({ id: 'bbLower', name: 'BB 하단', price: b.lower, color: SR_BB_COLOR });
  }
  return out;
}

/** 마지막 캔들 몸통(시가~종가 ± 오차 = max(호가, 0.15%), 꼬리 제외) 안에 든 레벨만, 입력 순서대로.
 * 호가 반올림 가격이 같으면 먼저 온 것 하나 */
export function touchedLevels(last: { open: number; close: number }, levels: IndicatorLevel[]): IndicatorLevel[] {
  const lo = Math.min(last.open, last.close);
  const hi = Math.max(last.open, last.close);
  const seen = new Set<number>();
  return levels.filter((lv) => {
    if (!Number.isFinite(lv.price) || lv.price <= 0) return false;
    const eps = srEps(lv.price);
    if (lv.price < lo - eps || lv.price > hi + eps) return false;
    const key = roundToTick(lv.price);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

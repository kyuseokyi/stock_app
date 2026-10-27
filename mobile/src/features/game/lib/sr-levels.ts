// 차트 게임 지지·저항 목록 — 수평선 2개(설계 2026-10-27 chart-game-sr-trendlines §7).
// 웹 web_client/src/lib/srLevels.ts 와 같은 규칙.
import { roundToTick } from './krx-tick';
import type { SrEventType } from './sr-watch';
import type { HLevel } from './trend-lines';

/** 레벨 가격 기반 키 — 저항을 돌파해 같은 선이 지지로 바뀌어도 키가 같아 감지기가 돌파를 놓치지 않는다 */
export type SrKey = `lvl:${number}`;
export type SrRole = 'support' | 'resistance';

export interface SrLevel {
  key: SrKey;
  price: number;
  color: string;
  role: SrRole;
}

/** 선 색은 역할로 고정(저항=주황, 지지=보라) */
export const TREND_HIGH_COLOR = '#f59e0b';
export const TREND_LOW_COLOR = '#8b5cf6';

/** 수평 레벨 → 지지·저항 목록(저항 먼저) */
export function srLevelsFromHorizontal(h: { resistance: HLevel | null; support: HLevel | null }): SrLevel[] {
  const out: SrLevel[] = [];
  if (h.resistance !== null) out.push({ key: `lvl:${h.resistance.price}`, price: h.resistance.price, color: TREND_HIGH_COLOR, role: 'resistance' });
  if (h.support !== null) out.push({ key: `lvl:${h.support.price}`, price: h.support.price, color: TREND_LOW_COLOR, role: 'support' });
  return out;
}

/** 감지용 — 후보 레벨 전체(그리는 2개와 별개). 키 lvl:가격, 가격 ≥ 현재가면 저항 */
export function srWatchLevels(candidates: HLevel[], lastPrice: number): SrLevel[] {
  return candidates.map((c) => {
    const resistance = c.price >= lastPrice;
    return { key: `lvl:${c.price}` as SrKey, price: c.price, color: resistance ? TREND_HIGH_COLOR : TREND_LOW_COLOR, role: resistance ? 'resistance' : 'support' };
  });
}

/** 역할 이름 — 넓게: 저항선·지지선 / 좁게: 저항·지지 */
export function srRoleName(role: SrRole, short: boolean): string {
  if (role === 'resistance') return short ? '저항' : '저항선';
  return short ? '지지' : '지지선';
}

/** 이벤트 종류로 본 선 이름(RESISTANCE_* = 저항선, SUPPORT_* = 지지선) */
export function srEventName(type: SrEventType): string {
  return srRoleName(type.startsWith('RESISTANCE') ? 'resistance' : 'support', false);
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|');
}

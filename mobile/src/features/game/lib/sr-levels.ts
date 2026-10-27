// 차트 게임 지지·저항 목록 — 추세선 2개의 마지막 캔들 위치 값(설계 2026-10-27 chart-game-sr-trendlines §3).
// 웹 web_client/src/lib/srLevels.ts 와 같은 규칙.
import { roundToTick } from './krx-tick';
import { valueAt, type TrendLine } from './trend-lines';

export type SrKey = 'trendHigh' | 'trendLow';
export type SrRole = 'support' | 'resistance';

export interface SrLevel {
  key: SrKey;
  price: number;
  color: string;
  role: SrRole;
}

/** 선 색은 어떤 선인지로 고정(저항 추세선=주황, 지지 추세선=보라) — 돌파로 역할이 바뀌어도 그대로 */
export const TREND_HIGH_COLOR = '#f59e0b';
export const TREND_LOW_COLOR = '#8b5cf6';

/** 추세선 → 지지·저항 목록(저항 추세선 먼저). 값이 현재가 이상이면 저항, 미만이면 지지 */
export function srLevelsFromTrends(
  lines: { resistance: TrendLine | null; support: TrendLine | null },
  lastIndex: number,
  lastPrice: number,
): SrLevel[] {
  const out: SrLevel[] = [];
  const add = (key: SrKey, line: TrendLine | null, color: string) => {
    if (line === null) return;
    const price = valueAt(line, lastIndex);
    if (!Number.isFinite(price) || price <= 0) return;
    out.push({ key, price, color, role: price >= lastPrice ? 'resistance' : 'support' });
  };
  add('trendHigh', lines.resistance, TREND_HIGH_COLOR);
  add('trendLow', lines.support, TREND_LOW_COLOR);
  return out;
}

/** 선 이름 — 넓게: 저항 추세선·지지 추세선 / 좁게: 저항 추세·지지 추세 */
export function srName(key: SrKey, short: boolean): string {
  if (key === 'trendHigh') return short ? '저항 추세' : '저항 추세선';
  return short ? '지지 추세' : '지지 추세선';
}

/** 다시 그릴지 판단용 — 키·역할·호가 반올림 가격이 같으면 같은 서명 */
export function srSignature(levels: SrLevel[]): string {
  return levels.map((l) => `${l.key}:${l.role}:${roundToTick(l.price)}`).join('|');
}

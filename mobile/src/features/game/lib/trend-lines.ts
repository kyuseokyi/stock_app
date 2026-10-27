// 차트 게임 지지·저항 수평선 — 스윙 고점·저점 중 현재가에 가장 가까운 위·아래(설계 2026-10-27 chart-game-sr-trendlines §7).
// 웹 web_client/src/lib/trendLines.ts 와 같은 코드.
export const TREND_PIVOT = 3;
export const TREND_LOOKBACK = 120;

export interface TrendBar {
  high: number;
  low: number;
}

export interface TrendOptions {
  pivot?: number;
  lookback?: number;
}

/** 마지막 lookback 개 안에서, 앞뒤 pivot 개 이상(같으면 나중 것)인 극점 순번들 */
function swings(bars: TrendBar[], start: number, pivot: number, pick: (b: TrendBar) => number, high: boolean): number[] {
  const out: number[] = [];
  for (let i = start + pivot; i <= bars.length - 1 - pivot; i++) {
    const v = pick(bars[i]);
    let ok = true;
    for (let k = 1; k <= pivot && ok; k++) {
      const l = pick(bars[i - k]);
      const r = pick(bars[i + k]);
      // 왼쪽은 크거나 같음(≥), 오른쪽은 엄격히 큼 → 같은 값이 이어지면 나중 것만 남는다
      ok = high ? v >= l && v > r : v <= l && v < r;
    }
    if (ok) out.push(i);
  }
  return out;
}

export interface HLevel {
  i: number;
  price: number;
}

/**
 * 수평 지지·저항 고르기 — 마지막 lookback 개 안의 스윙 고점(high)·스윙 저점(low) 전부가 후보.
 * 저항 = 현재가 이상 중 가장 낮은 가격, 지지 = 현재가 미만 중 가장 높은 가격(같은 가격이면 더 최근).
 * 고점·저점을 섞어 고르므로 뚫린 옛 고점은 지지, 깨진 옛 저점은 저항이 된다
 */
export function horizontalLevels(
  bars: TrendBar[],
  lastPrice: number,
  opts: TrendOptions = {},
): { resistance: HLevel | null; support: HLevel | null } {
  const pivot = opts.pivot ?? TREND_PIVOT;
  const lookback = opts.lookback ?? TREND_LOOKBACK;
  const start = Math.max(0, bars.length - lookback);
  const hi = (b: TrendBar) => b.high;
  const lo = (b: TrendBar) => b.low;
  const cands: HLevel[] = [
    ...swings(bars, start, pivot, hi, true).map((i) => ({ i, price: hi(bars[i]) })),
    ...swings(bars, start, pivot, lo, false).map((i) => ({ i, price: lo(bars[i]) })),
  ];
  let resistance: HLevel | null = null;
  let support: HLevel | null = null;
  for (const c of cands) {
    if (c.price >= lastPrice) {
      if (resistance === null || c.price < resistance.price || (c.price === resistance.price && c.i > resistance.i)) resistance = c;
    } else if (support === null || c.price > support.price || (c.price === support.price && c.i > support.i)) {
      support = c;
    }
  }
  return { resistance, support };
}

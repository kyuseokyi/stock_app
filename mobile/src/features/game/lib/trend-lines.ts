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
  /** 매물대 칩이 켜졌을 때 보이는 구간 POC 가격 — 스윙과 같은 규칙의 후보(시작 순번 = lookback 시작) */
  poc?: number | null;
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
 * candidates = 감지용 전체 후보(같은 가격은 하나). 고점·저점을 섞어 고르므로 뚫린 옛 고점은 지지, 깨진 옛 저점은 저항이 된다
 */
export function horizontalLevels(
  bars: TrendBar[],
  lastPrice: number,
  opts: TrendOptions = {},
): { resistance: HLevel | null; support: HLevel | null; candidates: HLevel[] } {
  const pivot = opts.pivot ?? TREND_PIVOT;
  const lookback = opts.lookback ?? TREND_LOOKBACK;
  const start = Math.max(0, bars.length - lookback);
  const hi = (b: TrendBar) => b.high;
  const lo = (b: TrendBar) => b.low;
  const cands: HLevel[] = [
    ...swings(bars, start, pivot, hi, true).map((i) => ({ i, price: hi(bars[i]) })),
    ...swings(bars, start, pivot, lo, false).map((i) => ({ i, price: lo(bars[i]) })),
  ];
  // 같은 가격이면 더 최근(i 큰) 스윙이 POC(i = start)보다 우선
  if (bars.length > 0 && opts.poc != null && Number.isFinite(opts.poc) && opts.poc > 0) cands.push({ i: start, price: opts.poc });
  // 같은 가격은 하나(i 큰 것) — 감지용 전체 후보(그리는 건 아래에서 고른 가장 가까운 위·아래 2개뿐)
  const byPrice = new Map<number, HLevel>();
  for (const c of cands) {
    const prev = byPrice.get(c.price);
    if (prev === undefined || c.i > prev.i) byPrice.set(c.price, c);
  }
  const candidates = [...byPrice.values()];
  let resistance: HLevel | null = null;
  let support: HLevel | null = null;
  for (const c of candidates) {
    if (c.price >= lastPrice) {
      if (resistance === null || c.price < resistance.price || (c.price === resistance.price && c.i > resistance.i)) resistance = c;
    } else if (support === null || c.price > support.price || (c.price === support.price && c.i > support.i)) {
      support = c;
    }
  }
  return { resistance, support, candidates };
}

/**
 * 전고점·전저점 — 마지막 lookback 개 안의 스윙 고점(high)·스윙 저점(low) 중 현재가에 가장 가까운 것(설계 §8-1).
 * 고점·저점 각각 위(≥ 현재가 중 최저)·아래(< 현재가 중 최고) 하나씩. 같은 가격이면 더 최근. 없으면 null.
 * 위·아래를 모두 주는 이유: 뚫은 직후의 레벨도 감시해야 돌파·이탈 알림을 놓치지 않는다
 */
export function nearestSwings(
  bars: TrendBar[],
  lastPrice: number,
  opts: { pivot?: number; lookback?: number } = {},
): { highAbove: HLevel | null; highBelow: HLevel | null; lowAbove: HLevel | null; lowBelow: HLevel | null } {
  const pivot = opts.pivot ?? TREND_PIVOT;
  const start = Math.max(0, bars.length - (opts.lookback ?? TREND_LOOKBACK));
  const pickNear = (idx: number[], price: (i: number) => number) => {
    let above: HLevel | null = null;
    let below: HLevel | null = null;
    for (const i of idx) {
      const p = price(i);
      if (p >= lastPrice) {
        if (above === null || p < above.price || (p === above.price && i > above.i)) above = { i, price: p };
      } else if (below === null || p > below.price || (p === below.price && i > below.i)) {
        below = { i, price: p };
      }
    }
    return { above, below };
  };
  const hi = pickNear(swings(bars, start, pivot, (b) => b.high, true), (i) => bars[i].high);
  const lo = pickNear(swings(bars, start, pivot, (b) => b.low, false), (i) => bars[i].low);
  return { highAbove: hi.above, highBelow: hi.below, lowAbove: lo.above, lowBelow: lo.below };
}

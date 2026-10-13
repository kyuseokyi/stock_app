// 순수 View 캔들 차트의 좌표 계산(네이티브 의존성 없음). 컴포넌트는 결과를 절대 배치만 한다.
// y 축: 위가 고가. 위·아래 CHART_PAD_Y 만큼 여백을 두어 꼬리/가격선이 테두리에 붙지 않게 한다.

export const CHART_PAD_Y = 8;
const BODY_RATIO = 0.6;

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface CandleBar {
  /** 몸통 좌측 x(px) */
  bodyLeft: number;
  bodyWidth: number;
  bodyTop: number;
  /** 최소 1px(시가=종가여도 보이게) */
  bodyHeight: number;
  /** 1px 꼬리의 좌측 x(px) — 슬롯 중앙 */
  wickLeft: number;
  wickTop: number;
  wickHeight: number;
  /** close >= open → 상승(빨강) */
  rising: boolean;
}

export interface CandleLayout {
  range: PriceRange;
  /** 캔들 1개가 차지하는 가로 폭 */
  slot: number;
  bars: CandleBar[];
}

/** 캔들 저가 최소~고가 최대 + 가격선(지지/저항/진입) 포함. 캔들 없으면 null. min=max 면 ±1 확장 */
export function priceRange(candles: Ohlc[], extraPrices: (number | null)[]): PriceRange | null {
  if (candles.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of candles) {
    min = Math.min(min, c.low);
    max = Math.max(max, c.high);
  }
  for (const p of extraPrices) {
    if (p === null || !Number.isFinite(p)) continue;
    min = Math.min(min, p);
    max = Math.max(max, p);
  }
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

/** 가격 → y(px). max → pad, min → height - pad, 선형 */
export function priceToY(price: number, range: PriceRange, height: number, pad: number = CHART_PAD_Y): number {
  const inner = height - pad * 2;
  return pad + ((range.max - price) / (range.max - range.min)) * inner;
}

/** 캔들 좌표 일괄 계산. 빈 입력·폭/높이 0 이하(onLayout 전)면 null */
export function layoutCandles(
  candles: Ohlc[],
  width: number,
  height: number,
  extraPrices: (number | null)[] = [],
): CandleLayout | null {
  if (width <= 0 || height <= 0) return null;
  const range = priceRange(candles, extraPrices);
  if (range === null) return null;
  const slot = width / candles.length;
  const bodyWidth = Math.max(1, Math.floor(slot * BODY_RATIO));
  const y = (p: number) => priceToY(p, range, height);
  const bars = candles.map((c, i): CandleBar => {
    const rising = c.close >= c.open;
    const top = y(Math.max(c.open, c.close));
    const bottom = y(Math.min(c.open, c.close));
    const wickTop = y(c.high);
    return {
      bodyLeft: i * slot + (slot - bodyWidth) / 2,
      bodyWidth,
      bodyTop: top,
      bodyHeight: Math.max(1, bottom - top),
      wickLeft: i * slot + slot / 2 - 0.5,
      wickTop,
      wickHeight: Math.max(1, y(c.low) - wickTop),
      rising,
    };
  });
  return { range, slot, bars };
}

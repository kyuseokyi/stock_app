// KRX 호가 단위(2023-01 KOSPI·KOSDAQ 통합) — 백엔드 apps/trading_game/services/sr_levels.krx_tick 과 같은 표.
// 웹 web_client/src/lib/krxTick.ts 와 같은 코드.
const TABLE: readonly (readonly [number, number])[] = [
  [2_000, 1],
  [5_000, 5],
  [20_000, 10],
  [50_000, 50],
  [200_000, 100],
  [500_000, 500],
];

/** 가격의 호가 단위(원) */
export function krxTick(price: number): number {
  for (const [limit, tick] of TABLE) if (price < limit) return tick;
  return 1_000;
}

/** 가장 가까운 호가로 반올림 */
export function roundToTick(price: number): number {
  const tick = krxTick(price);
  return Math.floor(price / tick + 0.5) * tick;
}

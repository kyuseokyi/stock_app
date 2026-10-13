import type { DailyCandle } from '../types';

/**
 * 틱 가격을 마지막 일봉에 병합(원본 불변). (web lib/candles.ts 와 동일)
 * 마지막 캔들 날짜가 today 이상이면(시계 오차로 last 가 더 최신인 경우 포함) last 에 병합해 날짜를 유지,
 * 마지막 캔들이 없거나 더 과거면 오늘 캔들 신규 생성.
 */
export function mergeTick(last: DailyCandle | null, today: string, price: number): DailyCandle {
  if (last && last.date >= today) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
  }
  return { date: today, open: price, high: price, low: price, close: price };
}

/** 캔들 배열에 틱 반영(새 배열). 같은 캔들에 병합되면 마지막 교체, 새 캔들이면 뒤에 추가 */
export function applyTick(candles: DailyCandle[], today: string, price: number): DailyCandle[] {
  const last = candles.length > 0 ? candles[candles.length - 1] : null;
  const next = mergeTick(last, today, price);
  return last !== null && next.date === last.date ? [...candles.slice(0, -1), next] : [...candles, next];
}

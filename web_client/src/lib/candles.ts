import type { DailyCandle } from '../types/game'

/**
 * 틱 가격을 마지막 일봉에 병합(원본 불변).
 * 마지막 캔들 날짜가 today 이상이면(시계 오차로 last 가 더 최신인 경우 포함) last 에 병합해 날짜를 유지,
 * 마지막 캔들이 없거나 더 과거면 오늘 캔들 신규 생성. (과거 날짜 바 생성 → 차트 예외 방지)
 */
export function mergeTick(last: DailyCandle | null, today: string, price: number): DailyCandle {
  if (last && last.date >= today) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
  }
  return { date: today, open: price, high: price, low: price, close: price }
}

import type { DailyCandle } from '../types/game'

/**
 * 틱 가격을 마지막 일봉에 병합(원본 불변).
 * 마지막 캔들 날짜가 today 면 고가/저가/종가 갱신, 아니면(없음 포함) 오늘 캔들 신규 생성.
 */
export function mergeTick(last: DailyCandle | null, today: string, price: number): DailyCandle {
  if (last && last.date === today) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
  }
  return { date: today, open: price, high: price, low: price, close: price }
}

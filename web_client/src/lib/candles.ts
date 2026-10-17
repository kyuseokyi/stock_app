import type { DailyCandle, IntradayCandle, IntradayInterval } from '../types/game'

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

/**
 * 분봉으로 만든 최근 거래일 봉(bar)을 일봉 끝에 잇는다(원본 불변).
 * 일봉은 20:30 수집 후에야 오늘 행이 생긴다 — bar 가 마지막 일봉보다 나중 날짜일 때만 붙이고,
 * 같은 날짜 일봉이 이미 있으면(수집 완료) 그 공식 값을 쓴다.
 */
export function withSessionBar(rows: DailyCandle[], bar: DailyCandle | null): DailyCandle[] {
  if (!bar || rows.length === 0) return rows
  if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return rows
  return bar.date > rows[rows.length - 1].date ? [...rows, bar] : rows
}

const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000
const MINUTES: Record<IntradayInterval, number> = { '1m': 1, '5m': 5, '15m': 15, '60m': 60 }

/**
 * nowMs 가 속한 분봉 버킷의 시작(UTC epoch seconds).
 * KST 자정부터 지난 분을 n 분 단위로 내림 — 09:00 장 시작과 60분 버킷이 KST 정시에 맞는다.
 */
export function bucketStartSec(nowMs: number, interval: IntradayInterval): number {
  const n = MINUTES[interval]
  const kstMs = nowMs + KST_OFFSET_MS
  const dayStart = Math.floor(kstMs / DAY_MS) * DAY_MS
  const minutes = Math.floor((kstMs - dayStart) / 60_000)
  const bucketKstMs = dayStart + Math.floor(minutes / n) * n * 60_000
  return (bucketKstMs - KST_OFFSET_MS) / 1000
}

/**
 * 틱 가격을 마지막 분봉에 병합(원본 불변).
 * last 가 bucketSec 이상(같은 버킷 또는 시계 오차로 더 최신)이면 last 에 병합해 시각 유지,
 * 없거나 더 과거면 새 버킷 캔들(거래량 0 — 틱 거래량은 서버 분봉에서만 집계).
 */
export function mergeTickIntraday(last: IntradayCandle | null, bucketSec: number, price: number): IntradayCandle {
  if (last && last.t >= bucketSec) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price }
  }
  return { t: bucketSec, open: price, high: price, low: price, close: price, volume: 0 }
}

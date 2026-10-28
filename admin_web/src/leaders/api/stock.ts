// web_client/src/api/stock.ts 복사본 — 원본과 같이 고칠 것 (변경: config 경로 → 관리자 src/config)
import axios from 'axios'
import { STOCK_API_URL } from '../../config'
import { kstDateString } from '../lib/format'
import type { DailyCandle } from '../types/game'

// stock_api GraphQL 일봉 조회(graphql-request 없이 axios POST — 신규 의존성 회피).

const QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close volume }
  }
}`

// 화면 180일 + 보조지표 워밍업(60일선·볼린저 20일 ≈ 60거래일 ≈ 달력 100일). 화면 구간은 TradingChart 가 잡는다
const LOOKBACK_DAYS = 280
const DAY_MS = 86_400_000

interface ChartResponse {
  data?: { getChartData: { candles: DailyCandle[] } | null } | null
  errors?: { message: string }[]
}

// 차트 왼쪽 스크롤로 과거를 이어 받을 때 — realOnly: 저장된 기간보다 과거면 가짜 대신 빈 candles(= 더 없음)
export const DAILY_HISTORY_QUERY = `query DailyHistory($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate, realOnly: true) {
    candles { date open high low close volume }
  }
}`

/** 과거 이어 받기 한 번에 요청하는 달력일 수(약 250거래일) */
export const HISTORY_PAGE_DAYS = 365

/** beforeDate(YYYY-MM-DD, 제외) 직전 days 달력일의 일봉. 저장된 기간보다 과거면 []. 오류면 throw */
export async function getDailyCandlesBefore(
  ticker: string, beforeDate: string, days: number = HISTORY_PAGE_DAYS,
): Promise<DailyCandle[]> {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL 미설정')
  const end = Date.parse(`${beforeDate}T00:00:00Z`) - DAY_MS
  const variables = {
    symbol: ticker,
    startDate: new Date(end - days * DAY_MS).toISOString().slice(0, 10),
    endDate: new Date(end).toISOString().slice(0, 10),
  }
  const { data } = await axios.post<ChartResponse>(STOCK_API_URL, { query: DAILY_HISTORY_QUERY, variables })
  if (data.errors && data.errors.length > 0) throw new Error('일봉 데이터 오류')
  return (data.data?.getChartData?.candles ?? []).filter((c) => c.date < beforeDate)
}

/** 최근 약 280일(기본, lookbackDays 로 늘릴 수 있음) 일봉(지표 워밍업 포함). URL 미설정·GraphQL 오류·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(
  ticker: string, now: Date = new Date(), lookbackDays: number = LOOKBACK_DAYS,
): Promise<DailyCandle[]> {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL 미설정')
  const variables = {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - lookbackDays * DAY_MS)),
    endDate: kstDateString(now),
  }
  const { data } = await axios.post<ChartResponse>(STOCK_API_URL, { query: QUERY, variables })
  const candles = data.data?.getChartData?.candles
  if ((data.errors && data.errors.length > 0) || !candles || candles.length === 0) {
    throw new Error('일봉 데이터 없음')
  }
  return candles
}

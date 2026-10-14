import axios from 'axios'
import { STOCK_API_URL } from '../config'
import { kstDateString } from '../lib/format'
import type { DailyCandle } from '../types/game'

// stock_api GraphQL 일봉 조회(graphql-request 없이 axios POST — 신규 의존성 회피).

const QUERY = `query GameDailyCandles($symbol: String!, $startDate: String!, $endDate: String!) {
  getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
    candles { date open high low close }
  }
}`

// 화면 180일 + 보조지표 워밍업(60일선·볼린저 20일 ≈ 60거래일 ≈ 달력 100일). 화면 구간은 TradingChart 가 잡는다
const LOOKBACK_DAYS = 280
const DAY_MS = 86_400_000

interface ChartResponse {
  data?: { getChartData: { candles: DailyCandle[] } | null } | null
  errors?: { message: string }[]
}

/** 최근 약 280일 일봉(지표 워밍업 포함). URL 미설정·GraphQL 오류·빈 응답이면 throw(차트만 오류 표시) */
export async function getDailyCandles(ticker: string, now: Date = new Date()): Promise<DailyCandle[]> {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL 미설정')
  const variables = {
    symbol: ticker,
    startDate: kstDateString(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)),
    endDate: kstDateString(now),
  }
  const { data } = await axios.post<ChartResponse>(STOCK_API_URL, { query: QUERY, variables })
  const candles = data.data?.getChartData?.candles
  if ((data.errors && data.errors.length > 0) || !candles || candles.length === 0) {
    throw new Error('일봉 데이터 없음')
  }
  return candles
}

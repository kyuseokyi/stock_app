import { GraphQLClient, gql } from 'graphql-request'
import { STOCK_API_URL } from '../config'
import type { ChartData, Stock } from '../types/stock'
import { stockAuthHeaders } from './stockAuth'

// stock_api GraphQL 엔드포인트(빌드 타임 주입, 폴백/fail-fast 는 ../config 참조).
// 요청마다 관리자 토큰을 붙인다 — 시세 스위치가 꺼져 있어도 관리자는 차트 삽입·퀴즈 관리가 되도록(A안 2-2)
const client = new GraphQLClient(STOCK_API_URL, { headers: () => stockAuthHeaders() })

const SEARCH_STOCKS = gql`
  query SearchStocks($query: String!) {
    searchStocks(query: $query) {
      symbol
      name
      market
      country
      currency
    }
  }
`

const GET_CHART_DATA = gql`
  query GetChartData(
    $symbol: String!
    $startDate: String!
    $endDate: String!
    $bbStdDev: Float
  ) {
    getChartData(
      symbol: $symbol
      startDate: $startDate
      endDate: $endDate
      bbStdDev: $bbStdDev
    ) {
      symbol
      name
      market
      currency
      candles {
        date
        open
        high
        low
        close
        volume
      }
      ma5
      ma20
      ma50
      ma120
      maOrder
      bollinger {
        period
        stdDev
        mid
        upper
        lower
      }
      volumeProfile {
        priceLow
        priceHigh
        volume
      }
    }
  }
`

export async function searchStocks(query: string): Promise<Stock[]> {
  const data = await client.request<{ searchStocks: Stock[] }>(SEARCH_STOCKS, { query })
  return data.searchStocks
}

export async function getChartData(
  symbol: string,
  startDate: string,
  endDate: string,
  bbStdDev = 2.0,
): Promise<ChartData> {
  const data = await client.request<{ getChartData: ChartData }>(GET_CHART_DATA, {
    symbol,
    startDate,
    endDate,
    bbStdDev,
  })
  return data.getChartData
}

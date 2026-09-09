import { GraphQLClient, gql } from 'graphql-request'
import { STOCK_API_URL } from '../config'

// stock_api GraphQL 엔드포인트(빌드 타임 주입, 폴백/fail-fast 는 ../config 참조)
const client = new GraphQLClient(STOCK_API_URL)

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

export async function searchStocks(query) {
  const data = await client.request(SEARCH_STOCKS, { query })
  return data.searchStocks
}

export async function getChartData(symbol, startDate, endDate, bbStdDev = 2.0) {
  const data = await client.request(GET_CHART_DATA, {
    symbol,
    startDate,
    endDate,
    bbStdDev,
  })
  return data.getChartData
}

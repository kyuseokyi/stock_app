import { GraphQLClient, gql } from 'graphql-request'

// stock_api GraphQL 엔드포인트 (기본 로컬 8002)
const STOCK_API_URL =
  import.meta.env.VITE_STOCK_API_URL || 'http://localhost:8002/graphql'

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
  query GetChartData($symbol: String!, $startDate: String!, $endDate: String!) {
    getChartData(symbol: $symbol, startDate: $startDate, endDate: $endDate) {
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
    }
  }
`

export async function searchStocks(query) {
  const data = await client.request(SEARCH_STOCKS, { query })
  return data.searchStocks
}

export async function getChartData(symbol, startDate, endDate) {
  const data = await client.request(GET_CHART_DATA, { symbol, startDate, endDate })
  return data.getChartData
}

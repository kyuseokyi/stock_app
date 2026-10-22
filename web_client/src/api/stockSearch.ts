import { gql } from './screener'

// 종목 검색(stock_api GraphQL searchStocks) — 종목 상세 화면 검색창·헤더(주도주 분석 대상이 아닌 종목의 이름)에 쓴다.
// backend/tests/test_stock_search_contract.py 가 이 파일의 *_QUERY 문자열을 실제 스키마로 실행한다(백틱 리터럴 유지).

export const STOCK_SEARCH_QUERY = `query StockSearch($query: String!) {
  searchStocks(query: $query) { symbol name market country }
}`

export interface StockHit {
  symbol: string
  name: string
  market: string
  country: string
}

/** 국내 종목만(상세 화면 데이터가 국내 전용) — 앞쪽 limit 개 */
export async function searchStocks(query: string, limit = 10): Promise<StockHit[]> {
  const q = query.trim()
  if (!q) return []
  const res = await gql<{ searchStocks: StockHit[] }>(STOCK_SEARCH_QUERY, { query: q }, 8000)
  return res.searchStocks.filter((s) => s.country === 'KR').slice(0, limit)
}

/** 코드로 종목 이름·시장 찾기 — 검색 결과 중 코드가 정확히 같은 것. 없으면 null */
export async function findStock(ticker: string): Promise<StockHit | null> {
  const hits = await searchStocks(ticker, 50)
  return hits.find((s) => s.symbol === ticker) ?? null
}

import { gql } from './screener'
import { FINDER_PAGE, toFilterInput } from '../lib/finder'
import type { FinderQuery, FinderScreen } from '../types/finder'

// stock_api GraphQL 조건검색(공개 — 로그인 불필요). 쿼리 문자열은 backend/tests/test_screener_contract.py 가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const FINDER_QUERY = `query ScreenerScreen($preset: String, $filters: ScreenerFilterInput, $sort: String!,
  $limit: Int!, $offset: Int!) {
  screenerScreen(preset: $preset, filters: $filters, sort: $sort, limit: $limit, offset: $offset) {
    date total bbSigma
    items {
      ticker name market sectorName close chg1d value mcap volRatio20 rsi14 maOrder isNewHigh gcDays vpAbovePct
      per pbr roe bbPosition bbWidthPct
    }
  }
}`

/** 조건검색 목록(offset 부터 50개) */
export async function getFinderScreen(q: FinderQuery, offset = 0): Promise<FinderScreen> {
  const res = await gql<{ screenerScreen: FinderScreen }>(FINDER_QUERY, {
    preset: q.preset,
    filters: toFilterInput(q.filters),
    sort: q.sort,
    limit: FINDER_PAGE,
    offset,
  })
  return res.screenerScreen
}

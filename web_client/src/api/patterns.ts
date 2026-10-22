import { gql } from './screener'
import { PATTERN_PAGE } from '../lib/patterns'
import type { PatternBases, PatternQuery, PatternScreen } from '../types/patterns'

// stock_api GraphQL 차트 패턴(공개 — 로그인 불필요). 쿼리 문자열은 backend/tests/test_pattern_contract.py 가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const PATTERN_SCREEN_QUERY = `query PatternScreen($report: String, $patternType: String, $market: String,
  $sort: String, $limit: Int, $offset: Int) {
  patternScreen(report: $report, patternType: $patternType, market: $market, sort: $sort, limit: $limit,
    offset: $offset) {
    date total
    items {
      ticker name market sectorName close patternType label stage pivot pivotDistPct depth length isActive
      breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout
    }
  }
}`

export const PATTERN_BASES_QUERY = `query PatternBases($ticker: String!) {
  patternBases(ticker: $ticker) {
    date ticker name close
    bases {
      patternType label stage subcount totalcount rimDate lowDate lowPrice pivot depth length isActive isCurrent
      breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout priorUptrendPct confidence
      points { role date price }
    }
    zones { buyLow buyHigh stopLow stopHigh }
  }
}`

/** 패턴 목록(offset 부터 50개) */
export async function getPatternScreen(q: PatternQuery, offset = 0): Promise<PatternScreen> {
  const res = await gql<{ patternScreen: PatternScreen }>(PATTERN_SCREEN_QUERY, {
    report: q.report,
    patternType: q.patternType,
    market: q.market === 'ALL' ? null : q.market,
    sort: q.sort,
    limit: PATTERN_PAGE,
    offset,
  })
  return res.patternScreen
}

/** 종목의 베이스 이력 + 매매 구간 */
export async function getPatternBases(ticker: string): Promise<PatternBases> {
  const res = await gql<{ patternBases: PatternBases }>(PATTERN_BASES_QUERY, { ticker })
  return res.patternBases
}

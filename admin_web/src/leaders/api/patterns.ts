// web_client/src/api/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 '오늘 볼 10개'가 쓰는 getPatternsNearPivot 만)
import { gql } from './screener'
import type { PatternItem, PatternScreen } from '../types/patterns'

// stock_api GraphQL 차트 패턴(공개 — 로그인 불필요). 쿼리 문자열은 원본(web_client)과 글자 그대로 같게 유지할 것
// (원본은 backend/tests/test_pattern_contract.py 가 실제 스키마로 실행해 검증한다).

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

/** 형성 중(활성) 패턴을 피벗에 가까운 순으로, 피벗까지 거리 절댓값이 maxAbs% 넘을 때까지(200개씩 최대 1000개) — '오늘 볼 10개' 후보 */
export async function getPatternsNearPivot(maxAbs: number): Promise<PatternItem[]> {
  const items: PatternItem[] = []
  for (let offset = 0; offset < 1000; offset += 200) {
    const { patternScreen } = await gql<{ patternScreen: PatternScreen }>(PATTERN_SCREEN_QUERY, {
      report: 'forming', patternType: null, market: null, sort: 'pivot_dist', limit: 200, offset,
    })
    items.push(...patternScreen.items)
    const last = patternScreen.items[patternScreen.items.length - 1]
    if (patternScreen.items.length < 200 || !last || Math.abs(last.pivotDistPct ?? Infinity) > maxAbs) break
  }
  return items
}

// web_client/src/api/patterns.ts 복사본 — 원본과 같이 고칠 것 (주도주 '오늘 볼 10개' getPatternsNearPivot + 상세 차트 패턴 getPatternBases + 관리자 차트 패턴 화면 getPatternScreen·getPatternDataset)
import { gql } from './screener'
import { PATTERN_PAGE } from '../lib/patterns'
import type { PatternBases, PatternItem, PatternQuery, PatternScreen } from '../types/patterns'

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

/** 관리자 갱신 현황 카드용 — 최신 기준일과 '형성 중' 종목 수(같은 쿼리를 1개만 받아 total 만 쓴다) */
export async function getPatternDataset(): Promise<{ date: string | null; total: number }> {
  const res = await gql<{ patternScreen: PatternScreen }>(PATTERN_SCREEN_QUERY, {
    report: 'forming', patternType: null, market: null, sort: 'pivot_dist', limit: 1, offset: 0,
  })
  return { date: res.patternScreen.date, total: res.patternScreen.total }
}

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

/** 종목의 베이스 이력 + 매매 구간 */
export async function getPatternBases(ticker: string): Promise<PatternBases> {
  const res = await gql<{ patternBases: PatternBases }>(PATTERN_BASES_QUERY, { ticker })
  return res.patternBases
}

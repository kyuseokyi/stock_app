import { stockRequest } from '@/lib/api';

import { PATTERN_PAGE } from './patterns';
import type { PatternBases, PatternItem, PatternQuery, PatternScreen } from './types';

// stock_api GraphQL 차트 패턴(공개). 쿼리 문자열은 backend/tests/test_pattern_contract.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const PATTERN_SCREEN_QUERY = `query PatternScreen($report: String, $patternType: String, $market: String, $sort: String,
  $limit: Int, $offset: Int) {
  patternScreen(report: $report, patternType: $patternType, market: $market, sort: $sort, limit: $limit, offset: $offset) {
    date total
    items {
      ticker name market sectorName close patternType label stage pivot pivotDistPct depth length isActive
      breakoutDate breakoutPricePct breakoutVolPct daysSinceBreakout
    }
  }
}`;

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
}`;

/** 패턴 목록(offset 부터 50개) */
export async function fetchPatternScreen(q: PatternQuery, offset = 0): Promise<PatternScreen> {
  const vars = { report: q.report, patternType: q.patternType, limit: PATTERN_PAGE, offset };
  return (await stockRequest<{ patternScreen: PatternScreen }>(PATTERN_SCREEN_QUERY, vars)).patternScreen;
}

/** 종목의 패턴 베이스 이력·매수/손절 구간 */
export async function fetchPatternBases(ticker: string): Promise<PatternBases> {
  return (await stockRequest<{ patternBases: PatternBases }>(PATTERN_BASES_QUERY, { ticker })).patternBases;
}

/** 형성 중 패턴을 피벗에 가까운 순으로 — |거리|가 maxAbs 를 넘으면 멈춘다('오늘 볼 10개' 후보) */
export async function fetchPatternsNearPivot(maxAbs: number): Promise<PatternItem[]> {
  const items: PatternItem[] = [];
  for (let offset = 0; offset < 1000; offset += 200) {
    const r = await stockRequest<{ patternScreen: PatternScreen }>(PATTERN_SCREEN_QUERY, {
      report: 'forming', patternType: null, market: null, sort: 'pivot_dist', limit: 200, offset,
    });
    items.push(...r.patternScreen.items);
    const last = r.patternScreen.items[r.patternScreen.items.length - 1];
    if (r.patternScreen.items.length < 200 || !last || Math.abs(last.pivotDistPct ?? Infinity) > maxAbs) break;
  }
  return items;
}

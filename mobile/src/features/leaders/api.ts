import { stockRequest } from '@/lib/api';

import { LEADERS_PAGE } from './canslim';
import type { CanslimItem, CanslimMarket, CanslimScore, CanslimScreen, ScreenFilters } from './types';

// stock_api GraphQL 주도주(CANSLIM) 조회(공개). 쿼리 문자열은 backend/tests/test_market_query.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.
// 문자열 안에 ${...} 끼워 넣기·백틱을 쓰지 말 것(테스트가 글자 그대로 실행한다).

export const SCREEN_QUERY = `query CanslimScreen($market: String!, $minPass: Int!, $required: [String!], $sort: String!,
  $liquidOnly: Boolean!, $limit: Int!, $offset: Int!) {
  canslimMarket { market date status close ma50 ma200 distributionDays }
  canslimScreen(market: $market, minPass: $minPass, required: $required, sort: $sort, liquidOnly: $liquidOnly,
    limit: $limit, offset: $offset) {
    date total
    items { ticker name market sectorName close score passCount liquid rs pctFromHigh letters { c a n s l i m } }
  }
}`;

export const SCORE_QUERY = `query CanslimScore($ticker: String!) {
  canslimScore(ticker: $ticker) {
    date ticker name market sectorName close score passCount marketStatus
    letters { key status value display threshold label explanation }
    history { date score passCount }
  }
}`;

/** 시장 방향 + 목록(offset 부터 50개) */
export async function fetchCanslimScreen(
  f: ScreenFilters,
  offset = 0,
): Promise<{ markets: CanslimMarket[]; screen: CanslimScreen }> {
  const vars = {
    market: f.market,
    minPass: f.minPass,
    required: f.required,
    sort: f.sort,
    liquidOnly: f.liquidOnly,
    limit: LEADERS_PAGE,
    offset,
  };
  const r = await stockRequest<{ canslimMarket: CanslimMarket[]; canslimScreen: CanslimScreen }>(SCREEN_QUERY, vars);
  return { markets: r.canslimMarket, screen: r.canslimScreen };
}

/** 종목 점수표 — 분석 대상이 아니면(ETF·우선주 등) null */
export async function fetchCanslimScore(ticker: string): Promise<CanslimScore | null> {
  return (await stockRequest<{ canslimScore: CanslimScore | null }>(SCORE_QUERY, { ticker })).canslimScore;
}

const BULK = 200; // 서버 MAX_LIMIT

/** 점수 minScore 이상 전부(전체 시장·거래 가능 종목, 점수 높은 순) — '오늘 볼 10개' 후보. 점수가 기준 아래로 내려가면 멈춘다 */
export async function fetchCanslimAbove(minScore: number): Promise<{ date: string | null; items: CanslimItem[] }> {
  const items: CanslimItem[] = [];
  let date: string | null = null;
  for (let offset = 0; offset < 1000; offset += BULK) {
    const r = await stockRequest<{ canslimScreen: CanslimScreen }>(SCREEN_QUERY, {
      market: 'ALL', minPass: 0, required: [], sort: 'score', liquidOnly: true, limit: BULK, offset,
    });
    date = r.canslimScreen.date;
    items.push(...r.canslimScreen.items);
    const last = r.canslimScreen.items[r.canslimScreen.items.length - 1];
    if (r.canslimScreen.items.length < BULK || !last || last.score < minScore) break;
  }
  return { date, items };
}

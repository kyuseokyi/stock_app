import { stockRequest } from '@/lib/api';

import { GROUP_PAGE } from './format';
import type { CalendarEvent, GroupDetail, GroupKind, GroupRanking, GroupSort, MarketOverview, Period } from './types';

// stock_api GraphQL 스크리너 조회(공개). 쿼리 문자열은 backend/tests/test_market_query.py 계약 테스트가
// 이 파일에서 그대로 읽어 실제 스키마로 실행한다 — `export const X_QUERY = \`...\`` 형식을 바꾸지 말 것.

export const OVERVIEW_QUERY = `query MarketOverview {
  marketOverview {
    indices { code name region date close chg1d spark live asOf }
    macro { seriesId name unit date value prev }
  }
}`;

export const GROUPS_QUERY = `query MarketGroups($kind: String!, $period: String!, $sort: String!, $limit: Int!, $offset: Int!) {
  marketGroups(kind: $kind, period: $period, sort: $sort, limit: $limit, offset: $offset) {
    date total
    items { id name members chg value up down flat leader { ticker name chg } rank streak }
  }
}`;

export const GROUP_QUERY = `query MarketGroup($kind: String!, $id: String!) {
  marketGroup(kind: $kind, id: $id) {
    kind id name description date chg1d chg5d chg20d value mcap up down flat rank
    history { date chg1d rank }
    stocks { ticker name close chg1d chg5d value mcap isLeader reason }
  }
}`;

export const CALENDAR_QUERY = `query MarketCalendar($start: String!, $end: String!, $category: String) {
  marketCalendar(start: $start, end: $end, category: $category) { date title category ticker name detail }
}`;

export async function fetchMarketOverview(): Promise<MarketOverview> {
  return (await stockRequest<{ marketOverview: MarketOverview }>(OVERVIEW_QUERY)).marketOverview;
}

export async function fetchMarketGroups(
  kind: GroupKind,
  period: Period,
  sort: GroupSort,
  offset = 0,
  limit = GROUP_PAGE,
): Promise<GroupRanking> {
  const vars = { kind, period, sort, limit, offset };
  return (await stockRequest<{ marketGroups: GroupRanking }>(GROUPS_QUERY, vars)).marketGroups;
}

export async function fetchMarketGroup(kind: GroupKind, id: string): Promise<GroupDetail | null> {
  return (await stockRequest<{ marketGroup: GroupDetail | null }>(GROUP_QUERY, { kind, id })).marketGroup;
}

export async function fetchMarketCalendar(start: string, end: string, category?: string): Promise<CalendarEvent[]> {
  const vars = { start, end, category: category ?? null };
  return (await stockRequest<{ marketCalendar: CalendarEvent[] }>(CALENDAR_QUERY, vars)).marketCalendar;
}

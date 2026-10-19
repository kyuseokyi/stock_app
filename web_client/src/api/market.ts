import { gql } from './screener'
import type {
  CalendarEvent,
  GroupDetail,
  GroupKind,
  GroupRanking,
  GroupSort,
  MarketOverview,
  Period,
  Treemap,
  TreemapSize,
} from '../types/market'

// stock_api GraphQL 시장 탭 조회(공개). 쿼리 문자열은 backend/tests/test_market_query.py 계약 테스트가 파일에서 읽어 실제 스키마로 실행한다.

export const OVERVIEW_QUERY = `query MarketOverview {
  marketOverview {
    indices { code name region date close chg1d spark }
    macro { seriesId name unit date value prev }
  }
}`

export const GROUPS_QUERY = `query MarketGroups($kind: String!, $period: String!, $sort: String!, $limit: Int!, $offset: Int!) {
  marketGroups(kind: $kind, period: $period, sort: $sort, limit: $limit, offset: $offset) {
    date total
    items { id name members chg value up down flat leader { ticker name chg } rank streak }
  }
}`

export const TREEMAP_QUERY = `query MarketTreemap($kind: String!, $size: String!, $period: String!) {
  marketTreemap(kind: $kind, size: $size, period: $period) {
    date
    groups { id name chg size stocks { ticker name chg size } }
  }
}`

export const GROUP_QUERY = `query MarketGroup($kind: String!, $id: String!) {
  marketGroup(kind: $kind, id: $id) {
    kind id name description date chg1d chg5d chg20d value mcap up down flat rank
    history { date chg1d rank }
    stocks { ticker name close chg1d chg5d value mcap isLeader reason }
  }
}`

export const CALENDAR_QUERY = `query MarketCalendar($start: String!, $end: String!, $category: String) {
  marketCalendar(start: $start, end: $end, category: $category) { date title category ticker name detail }
}`

export const GROUP_PAGE = 30

export async function getMarketOverview(): Promise<MarketOverview> {
  return (await gql<{ marketOverview: MarketOverview }>(OVERVIEW_QUERY, {})).marketOverview
}

export async function getMarketGroups(
  kind: GroupKind,
  period: Period,
  sort: GroupSort,
  offset = 0,
  limit = GROUP_PAGE,
): Promise<GroupRanking> {
  const vars = { kind, period, sort, limit, offset }
  return (await gql<{ marketGroups: GroupRanking }>(GROUPS_QUERY, vars)).marketGroups
}

export async function getMarketTreemap(kind: GroupKind, size: TreemapSize, period: Period): Promise<Treemap> {
  return (await gql<{ marketTreemap: Treemap }>(TREEMAP_QUERY, { kind, size, period })).marketTreemap
}

export async function getMarketGroup(kind: GroupKind, id: string): Promise<GroupDetail | null> {
  return (await gql<{ marketGroup: GroupDetail | null }>(GROUP_QUERY, { kind, id })).marketGroup
}

export async function getMarketCalendar(start: string, end: string, category?: string): Promise<CalendarEvent[]> {
  const vars = { start, end, category: category ?? null }
  return (await gql<{ marketCalendar: CalendarEvent[] }>(CALENDAR_QUERY, vars)).marketCalendar
}

import { queryOptions } from '@tanstack/react-query'
import { getMarketCalendar, getMarketGroups } from '../api/market'
import type { GroupKind, GroupSort, Period } from '../types/market'

// 시장 화면 조회 정의 — 기존 api 함수를 그대로 감싼다(API 계약 변경 없음). 키: ['market', 종류, ...파라미터]
// queryFn 은 항상 인자 없이 감싼다(Query 컨텍스트 객체가 api 함수의 선택 인자 자리에 들어가지 않게)
export const marketQueries = {
  /** 일정 — 기간·분류별 */
  calendar: (start: string, end: string, category?: string) =>
    queryOptions({
      queryKey: ['market', 'calendar', start, end, category ?? null] as const,
      queryFn: () => getMarketCalendar(start, end, category),
    }),
  /** 테마·업종 순위 첫 쪽 — '더 보기'로 이어 붙인 쪽은 화면이 따로 들고 있다 */
  groups: (kind: GroupKind, period: Period, sort: GroupSort) =>
    queryOptions({
      queryKey: ['market', 'groups', kind, period, sort] as const,
      queryFn: () => getMarketGroups(kind, period, sort),
      // 재연결 때 첫 쪽만 바꾸면 이어 붙인 쪽과 순서가 섞인다 — 지금처럼 재연결 재조회 없음
      refetchOnReconnect: false,
    }),
}

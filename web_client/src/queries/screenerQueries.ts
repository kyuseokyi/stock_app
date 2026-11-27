import { queryOptions } from '@tanstack/react-query'
import { getFinderScreen } from '../api/finder'
import { getPatternScreen } from '../api/patterns'
import type { FinderQuery } from '../types/finder'
import type { PatternQuery } from '../types/patterns'

// 스크리너 조회 정의 — 기존 api 함수를 그대로 감싼다(API 계약 변경 없음). 키: ['screener', 종류, 조건]
// 첫 쪽만 Query 로 받는다 — '더 보기'로 이어 붙인 쪽은 화면이 들고 있어, 재연결 때 첫 쪽만 바뀌어 섞이지 않게 재연결 재조회는 끈다.
export const screenerQueries = {
  /** 조건검색 첫 쪽 */
  finder: (q: FinderQuery) =>
    queryOptions({
      queryKey: ['screener', 'finder', q] as const,
      queryFn: () => getFinderScreen(q),
      refetchOnReconnect: false,
    }),
  /** 차트 패턴 첫 쪽 */
  patterns: (q: PatternQuery) =>
    queryOptions({
      queryKey: ['screener', 'patterns', q] as const,
      queryFn: () => getPatternScreen(q),
      refetchOnReconnect: false,
    }),
}

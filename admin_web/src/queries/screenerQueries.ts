import { queryOptions } from '@tanstack/react-query'
import { getFinderScreen } from '../api/finder'
import { getPatternScreen } from '../leaders/api/patterns'
import type { FinderQuery } from '../types/finder'
import type { PatternQuery } from '../leaders/types/patterns'

// 관리자 시장 데이터(스크리너) 조회 정의 — 기존 api 함수를 그대로 감싼다(API 계약 변경 없음). 키: ['screener', 종류, ...조건]
// '더 보기' 목록은 첫 쪽만 Query 로 받는다 — 이어 붙인 쪽은 화면이 들고 있어, 재연결 때 첫 쪽만 바뀌어 섞이지 않게 재연결 재조회는 끈다.
// queryFn 은 항상 인자 없이 감싼다(Query 컨텍스트 객체가 api 함수의 선택 인자 자리에 들어가지 않게)
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

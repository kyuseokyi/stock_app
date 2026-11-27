import { queryOptions, skipToken } from '@tanstack/react-query'
import {
  getNews, getStockDetail, getThemeDetail, listDates, listGroups, listStocks, type ListParams,
} from '../api/dailySurge'
import { getFinderScreen } from '../api/finder'
import { getMaScreener, type MaScreenerFilterInput, type MaSort } from '../api/maScreener'
import { getCanslimScreen } from '../leaders/api/screener'
import { getPatternScreen } from '../leaders/api/patterns'
import type { FinderQuery } from '../types/finder'
import type { PatternQuery } from '../leaders/types/patterns'
import type { ScreenFilters } from '../leaders/types/screener'
import type { Selection } from '../components/dailySurge/DetailPanel'

// 관리자 시장 데이터(스크리너) 조회 정의 — 기존 api 함수를 그대로 감싼다(API 계약 변경 없음). 키: ['screener', 종류, ...조건]
// '더 보기' 목록은 첫 쪽만 Query 로 받는다 — 이어 붙인 쪽은 화면이 들고 있어, 재연결 때 첫 쪽만 바뀌어 섞이지 않게 재연결 재조회는 끈다.
// queryFn 은 항상 인자 없이 감싼다(Query 컨텍스트 객체가 api 함수의 선택 인자 자리에 들어가지 않게)
export const screenerQueries = {
  /** 주도주(CANSLIM) — 시장 상태 + 목록 첫 쪽 */
  leaders: (f: ScreenFilters) =>
    queryOptions({
      queryKey: ['screener', 'leaders', f] as const,
      queryFn: () => getCanslimScreen(f),
      refetchOnReconnect: false,
    }),
  /** 5·20 정배열 스크리너 첫 쪽 */
  maScreener: (filters: MaScreenerFilterInput, sort: MaSort) =>
    queryOptions({
      queryKey: ['screener', 'maScreener', filters, sort] as const,
      queryFn: () => getMaScreener(filters, sort),
      refetchOnReconnect: false,
    }),
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
  /** 급등락·테마 분석 — 목록(묶음·종목)은 ['screener','dailySurge','list', …] 아래에 두어 메모 저장 뒤 목록만 무효화한다 */
  dailySurge: {
    dates: () =>
      queryOptions({ queryKey: ['screener', 'dailySurge', 'dates'] as const, queryFn: () => listDates() }),
    /** 테마 묶음 한 쪽 — 같은 날짜에서 쪽만 바뀔 때만 이전 쪽을 보여 주며 넘긴다 */
    groups: (date: string | null, page: number, pageSize: number) =>
      queryOptions({
        queryKey: ['screener', 'dailySurge', 'list', 'groups', date, page, pageSize] as const,
        queryFn: date ? () => listGroups(date, page, pageSize) : skipToken,
        placeholderData: (prev, prevQuery) =>
          prevQuery?.queryKey[4] === date && prevQuery.queryKey[6] === pageSize ? prev : undefined,
      }),
    /** 급등·급락·거래대금 종목 한 쪽 — 쪽 번호 말고 같은 조건일 때만 이전 쪽을 보여 주며 넘긴다 */
    stocks: (params: ListParams | null) =>
      queryOptions({
        queryKey: ['screener', 'dailySurge', 'list', 'stocks', params] as const,
        queryFn: params ? () => listStocks(params) : skipToken,
        placeholderData: (prev, prevQuery) => {
          const before = prevQuery?.queryKey[4] as ListParams | null | undefined
          if (!before || !params) return undefined
          return JSON.stringify({ ...before, page: 0 }) === JSON.stringify({ ...params, page: 0 }) ? prev : undefined
        },
      }),
    /** 오른쪽 상세(테마 묶음 또는 종목) */
    detail: (date: string, selection: Selection | null) =>
      queryOptions({
        queryKey: ['screener', 'dailySurge', 'detail', date, selection] as const,
        queryFn: selection
          ? async () =>
              selection.kind === 'stock'
                ? { kind: 'stock' as const, stock: await getStockDetail(date, selection.ticker) }
                : { kind: 'theme' as const, theme: await getThemeDetail(date, selection.themeId, selection.direction) }
          : skipToken,
      }),
    /** 네이버 뉴스 검색 결과(서버가 5분 캐시) */
    news: (kind: 'stock' | 'theme', date: string, target: string) =>
      queryOptions({
        queryKey: ['screener', 'dailySurge', 'news', kind, date, target] as const,
        queryFn: () => getNews(kind, date, target),
      }),
  },
}

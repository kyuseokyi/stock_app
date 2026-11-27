import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MARKET_REQUEST_TIMEOUT_MS } from '../lib/marketLive'

export interface SectionState<T> {
  data: T | null
  loading: boolean
  failed: boolean
}

// fetcher 함수마다 고정 번호 — 훅 인자를 바꾸지 않고 조회 키를 만든다(fetcher 가 바뀌면 키도 바뀌어 다시 불러온다)
const fetcherIds = new WeakMap<object, number>()
let nextFetcherId = 0
function fetcherId(f: object): number {
  let id = fetcherIds.get(f)
  if (id === undefined) {
    id = ++nextFetcherId
    fetcherIds.set(f, id)
  }
  return id
}

/**
 * 마켓 개요의 한 섹션을 불러오는 상태 — 섹션마다 따로라 하나가 실패해도 나머지는 그대로 보인다(앱 use-rest-resource 와 같은 방식).
 * 내부는 TanStack Query(['marketSection', fetcher 번호, enabled]) — 입출력과 동작은 Query 도입 전과 같다.
 * - fetcher 가 바뀌면 다시 불러온다 — 호출부는 모듈 함수나 useCallback 으로 고정해 넘긴다
 * - reload: 첫 로딩·[다시 시도]. 진행 중인 앞 요청은 취소돼 늦게 온 옛 응답이 화면을 덮지 않는다
 * - silentRefresh: 자동 갱신·복귀 재조회. 실패는 삼키고 이전 값을 유지, 앞 요청이 끝나기 전에는 건너뛴다
 * - keepCurrent: true 를 돌려주면 자동 갱신 결과로 화면을 바꾸지 않는다(히트맵: 기준일이 같으면 들어가 있던 종목 보기를 유지)
 * - fetchedAt: 마지막 조회가 끝난 시각(복귀 재조회 판정용) — 실패해도 찍어야 첫 로드 실패 뒤에도 복귀 재조회가 돈다
 * - enabled: false 면 요청하지 않고 빈 상태(로딩·실패 아님)로 둔다 — 시세 비노출(A안)로 숨긴 섹션이 403 을 부르지 않게.
 *   true 로 바뀌면(로그인 등) 그때 불러온다. 기본 true(지금과 같음)
 * Query 기본값 중 지금 동작과 다른 것은 여기서 끈다: 재시도 없음, 캐시 유지 없음(다시 들어오면 새로 불러옴), 재연결 재조회 없음.
 */
export function useMarketSection<T>(
  fetcher: (timeoutMs?: number) => Promise<T>,
  keepCurrent?: (cur: T, next: T) => boolean,
  enabled = true,
) {
  const qc = useQueryClient()
  // enabled 를 키에 넣는다 — 껐다 켜면 새 조회(로딩부터)로 시작해 지금처럼 옛 값이 비치지 않는다
  const queryKey = useMemo(() => ['marketSection', fetcherId(fetcher), enabled] as const, [fetcher, enabled])
  const seq = useRef(0) // reload·조건 변경 번호 — 그 전에 시작한 조용한 갱신의 응답은 버린다
  const busy = useRef(false)
  const fetchedAt = useRef<number | null>(null)

  const query = useQuery({
    queryKey,
    // 인자 없이 부른다(Query 가 넘기는 컨텍스트 객체가 timeoutMs 자리에 들어가지 않게)
    queryFn: async () => {
      try {
        return await fetcher()
      } finally {
        fetchedAt.current = Date.now()
      }
    },
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  })

  useEffect(
    () => () => {
      seq.current += 1 // 언마운트·조건 변경 — 진행 중인 조용한 갱신 응답은 버린다
    },
    [queryKey],
  )

  const reload = useCallback(async () => {
    seq.current += 1
    if (!enabled) return
    await qc.refetchQueries({ queryKey, exact: true })
  }, [qc, queryKey, enabled])

  const silentRefresh = useCallback(async () => {
    if (busy.current || !enabled) return
    busy.current = true
    const id = seq.current
    try {
      const data = await fetcher(MARKET_REQUEST_TIMEOUT_MS)
      if (id !== seq.current) return
      qc.setQueryData<T>(queryKey, (cur) =>
        cur !== undefined && cur !== null && data !== null && keepCurrent?.(cur, data) ? cur : data,
      )
    } catch {
      // 다음 주기·복귀 때 다시 묻는다 — 보이던 값은 그대로
    } finally {
      busy.current = false
      fetchedAt.current = Date.now()
    }
  }, [qc, queryKey, fetcher, keepCurrent, enabled])

  const fetching = query.fetchStatus === 'fetching'
  const state: SectionState<T> = {
    data: enabled ? (query.data ?? null) : null,
    loading: enabled && fetching,
    failed: enabled && query.status === 'error' && !fetching,
  }

  return { ...state, reload, silentRefresh, fetchedAt }
}

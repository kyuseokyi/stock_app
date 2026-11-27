import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { stampFetch } from './auto-refresh';
import { errorCode } from './format';

export type ResourceState<T> = { data: T | null; loading: boolean; error: string | null };

// fetcher 함수마다 고정 번호 — 훅 인자를 바꾸지 않고 조회 키를 만든다(fetcher 가 바뀌면 키도 바뀌어 다시 불러온다)
const fetcherIds = new WeakMap<object, number>();
let nextFetcherId = 0;
function fetcherId(f: object): number {
  let id = fetcherIds.get(f);
  if (id === undefined) {
    id = ++nextFetcherId;
    fetcherIds.set(f, id);
  }
  return id;
}

/**
 * REST 한 건을 불러오는 공용 상태(마켓 대시보드 섹션마다 따로 — 하나가 실패해도 나머지는 그대로).
 * 내부는 TanStack Query(['restResource', fetcher 번호, enabled]) — 입출력과 동작은 Query 도입 전과 같다(use-rest-resource.test.ts).
 * - fetcher 가 바뀌면(히트맵 기준 전환 등) 다시 불러온다 — 호출부는 useCallback 으로 고정해 넘긴다
 * - reload: 첫 로딩·[다시 시도]. 실패해도 이전 데이터는 남긴다(오류 코드만 기록)
 * - refresh: 당겨서 새로고침 — 실패하면 throw(호출부가 모아서 판단), 화면의 오류 표시는 바꾸지 않는다
 * - silentRefresh: 자동 새로고침 — 번호를 올리지 않아 진행 중인 전체 새로고침을 막지 않는다. 실패하면 throw
 * - fetchedAt: 마지막 조회가 끝난 시각(성공·실패 무관) — 복귀 재조회(useReturnRefresh) 판정용
 * 요청 번호(seq)로 reload·refresh 전에 시작한 늦은 응답이 새 결과를 덮지 않게 한다.
 * - enabled: false 면 요청하지 않고 빈 상태(로딩·오류 아님)로 둔다 — 시세 비노출(A안)로 숨긴 섹션이 403 을 부르지 않게.
 *   true 로 바뀌면(로그인 등) 그때 불러온다. 기본 true
 * refresh·silentRefresh 는 Query 재조회 대신 fetcher 를 직접 불러 성공할 때만 캐시에 넣는다 —
 * Query 로 재조회하면 실패 시 query 가 error 상태가 되어 "실패해도 오류 표시는 그대로"가 깨진다.
 * Query 기본값 중 지금 동작과 다른 것은 여기서 끈다: 재시도 없음, 캐시 유지 없음(다시 들어오면 새로 불러옴).
 */
export function useRestResource<T>(fetcher: () => Promise<T>, enabled = true) {
  const qc = useQueryClient();
  // enabled 를 키에 넣는다 — 껐다 켜면 새 조회(로딩부터)로 시작해 옛 값이 비치지 않는다
  const queryKey = useMemo(() => ['restResource', fetcherId(fetcher), enabled] as const, [fetcher, enabled]);
  const seq = useRef(0);
  const fetchedAt = useRef<number | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => stampFetch(fetchedAt, fetcher),
    enabled,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    structuralSharing: false,
  });

  useEffect(
    () => () => {
      seq.current += 1; // 언마운트·조건 변경 — 진행 중인 refresh·silentRefresh 응답은 버린다
    },
    [queryKey],
  );

  const reload = useCallback(async () => {
    seq.current += 1;
    if (!enabled) return;
    await qc.refetchQueries({ queryKey, exact: true });
  }, [qc, queryKey, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    await qc.cancelQueries({ queryKey, exact: true }); // 진행 중인 reload 결과가 이 결과를 덮지 않게
    const data = await stampFetch(fetchedAt, fetcher);
    if (id === seq.current) qc.setQueryData<T>(queryKey, data);
  }, [qc, queryKey, fetcher, enabled]);

  const silentRefresh = useCallback(async () => {
    if (!enabled) return;
    const id = seq.current;
    const data = await stampFetch(fetchedAt, fetcher);
    if (id === seq.current) qc.setQueryData<T>(queryKey, data);
  }, [qc, queryKey, fetcher, enabled]);

  const fetching = query.fetchStatus === 'fetching';
  const state: ResourceState<T> = {
    data: enabled ? (query.data ?? null) : null,
    loading: enabled && fetching,
    error: enabled && !fetching && query.status === 'error' ? errorCode(query.error) : null,
  };

  return { ...state, reload, refresh, silentRefresh, fetchedAt };
}

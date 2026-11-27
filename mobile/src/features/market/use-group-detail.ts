import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchMarketGroup } from './api';
import { errorCode } from './format';
import type { GroupDetail, GroupKind } from './types';

/**
 * 테마·업종 상세. 내부는 TanStack Query(['marketGroup', 종류, id]) — 입출력·동작은 Query 도입 전과 같다(use-group-detail.test.ts).
 * 의도된 차이 하나: 같은 그룹으로 30초(staleTime) 안에 돌아오면 저장된 결과를 다시 받지 않고 바로 보여 준다.
 * - reload(첫 로딩·[다시 시도]) 하는 동안은 보이던 내용을 둔다. 실패하면 data 를 비우고 오류 코드
 *   (Query 는 실패해도 data 를 남기므로 error 상태면 비워서 보여 준다)
 * - 응답이 null 이면 notFound
 */
export function useGroupDetail(kind: GroupKind, id: string) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['marketGroup', kind, id] as const, [kind, id]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchMarketGroup(kind, id),
    // 종류·id 가 바뀌어 받는 동안 이전 내용을 둔다(Query 도입 전과 같음). 이전 조회가 실패였으면 넘기지 않음
    placeholderData: (prev, prevQuery) => (prevQuery?.state.status === 'error' ? undefined : prev),
    structuralSharing: false,
  });

  const reload = useCallback(async () => {
    await qc.refetchQueries({ queryKey, exact: true });
  }, [qc, queryKey]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw). 직접 받아 성공할 때만 캐시에 넣는다(실패해도 오류 표시는 그대로) */
  const refresh = useCallback(async () => {
    const data = await fetchMarketGroup(kind, id);
    qc.setQueryData<GroupDetail | null>(queryKey, data);
  }, [qc, queryKey, kind, id]);

  const fetching = query.fetchStatus === 'fetching';
  const failed = query.status === 'error';
  const shown = failed ? undefined : query.data;

  return {
    data: shown ?? null,
    loading: fetching,
    error: !fetching && failed ? errorCode(query.error) : null,
    notFound: shown === null,
    reload,
    refresh,
  };
}

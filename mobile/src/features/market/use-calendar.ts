import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { kstDateString } from '@/features/game/lib/format';

import { stampFetch } from './auto-refresh';
import { fetchMarketCalendar } from './api';
import { errorCode, shiftDate, splitEvents } from './format';
import type { CalendarEvent } from './types';

export type CalendarCategory = '전체' | '공모주' | '경제지표';

type Split = { past: CalendarEvent[]; upcoming: CalendarEvent[] };

const EMPTY: CalendarEvent[] = [];

/**
 * 일정 — 지난 7일 + 앞으로 60일, 분류 칩. 분류를 빠르게 바꿔도 마지막 요청만 반영.
 * 내부는 TanStack Query(['marketCalendar', 분류, 오늘]) — 입출력·동작은 Query 도입 전과 같다(use-calendar.test.ts).
 * 의도된 차이 하나: 같은 분류로 30초(staleTime) 안에 돌아오면 저장된 결과를 다시 받지 않고 바로 보여 준다.
 * - 분류를 바꾸는 동안은 이전 목록을 둔 채 loading(placeholderData). 이전 조회가 실패였으면 빈 목록
 * - reload 실패는 목록을 비우고 오류 코드(Query 는 data 를 남기므로 error 상태면 비워서 보여 준다)
 * - refresh: 받는 중이면 Query 로 다시 받아(진행 중 요청을 대신 끝맺음) 실패가 곧 reload 실패와 같게,
 *   아니면 직접 받아 성공할 때만 캐시에 넣는다(실패해도 오류 표시는 그대로). 실패하면 throw
 * - silentRefresh: 번호를 올리지 않고 스피너 없이 바꾼다. 실패는 호출한 쪽이 삼킨다
 * 요청 번호(seq)로 reload·refresh·분류 변경 전에 시작한 늦은 응답이 새 결과를 덮지 않게 한다.
 */
export function useCalendar() {
  const [category, setCategory] = useState<CalendarCategory>('전체');
  const today = kstDateString();
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['marketCalendar', category, today] as const, [category, today]);
  const seq = useRef(0);
  const fetchedAt = useRef<number | null>(null);

  const fetchSplit = useCallback(async (): Promise<Split> => {
    const events = await stampFetch(fetchedAt, () =>
      fetchMarketCalendar(
        shiftDate(today, -7),
        shiftDate(today, 60),
        category === '전체' ? undefined : category,
      ),
    );
    return splitEvents(events, today);
  }, [category, today]);

  const query = useQuery({
    queryKey,
    queryFn: fetchSplit,
    // 이전 분류 목록을 둔 채 로딩(이전 조회가 실패였으면 이미 비웠으니 넘기지 않음)
    placeholderData: (prev, prevQuery) => (prevQuery?.state.status === 'error' ? undefined : prev),
    structuralSharing: false,
  });

  useEffect(
    () => () => {
      seq.current += 1; // 언마운트·분류 변경 — 진행 중인 refresh·silentRefresh 응답은 버린다
    },
    [queryKey],
  );

  const reload = useCallback(async () => {
    seq.current += 1;
    await qc.refetchQueries({ queryKey, exact: true });
  }, [qc, queryKey]);

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    if (qc.getQueryState(queryKey)?.fetchStatus === 'fetching') {
      // 무시하게 된 진행 중 reload 를 대신 끝맺을 때는 reload 실패와 같게(옛 분류 일정·빈 상태 문구 방지)
      // 먼저 취소한다 — data 가 아직 없는 query 는 refetch 가 진행 중 요청에 합쳐질 뿐 새로 받지 않는다
      try {
        await qc.cancelQueries({ queryKey, exact: true });
        await qc.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
      } catch (e) {
        // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
        if (id !== seq.current) return;
        throw e;
      }
      return;
    }
    let r: Split;
    try {
      r = await fetchSplit();
    } catch (e) {
      if (id !== seq.current) return;
      throw e;
    }
    if (id === seq.current) qc.setQueryData<Split>(queryKey, r);
  }, [qc, queryKey, fetchSplit]);

  const silentRefresh = useCallback(async () => {
    const id = seq.current;
    const r = await fetchSplit();
    if (id === seq.current) qc.setQueryData<Split>(queryKey, r);
  }, [qc, queryKey, fetchSplit]);

  const fetching = query.fetchStatus === 'fetching';
  const failed = query.status === 'error';
  const shown = failed ? undefined : query.data;

  return {
    past: shown?.past ?? EMPTY,
    upcoming: shown?.upcoming ?? EMPTY,
    loading: fetching,
    error: !fetching && failed ? errorCode(query.error) : null,
    today,
    category,
    setCategory,
    reload,
    refresh,
    silentRefresh,
    fetchedAt,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { stampFetch } from './auto-refresh';
import { fetchMarketGroups } from './api';
import { errorCode, GROUP_PAGE, hasMoreGroups, mergeGroupPage } from './format';
import type { GroupItem, GroupKind, GroupSort, Period } from './types';

/** 캐시에 두는 목록 — 첫 페이지(+ 더 불러온 것) */
type Page = { items: GroupItem[]; total: number; date: string | null; hasMore: boolean };

/** 더 불러오기 표시 — 어느 조회 키(배열 자체)에서 생긴 것인지 함께 둔다. 키가 바뀌면 자동으로 꺼진다 */
type More = { key: readonly unknown[] | null; loadingMore: boolean; moreFailed: boolean };

const NO_MORE: More = { key: null, loadingMore: false, moreFailed: false };
const EMPTY: GroupItem[] = [];

/**
 * 테마·업종 순위 — 기간·정렬 조건, 30개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영.
 * 내부는 TanStack Query(['marketGroups', 종류, 기간, 정렬]) — 입출력·동작은 Query 도입 전과 같다(use-group-ranking.test.ts).
 * 의도된 차이 하나: 같은 조건으로 30초(staleTime) 안에 돌아오면 저장된 결과(더 불러온 것 포함)를 다시 받지 않고 바로 보여 준다.
 * - 첫 페이지는 Query 가 받고, 더 불러오기는 직접 받아 캐시 목록에 이어 붙인다(useInfiniteQuery 는 재조회 때 모든 페이지를 다시 받아 안 씀)
 * - 조건을 바꾸는 동안은 이전 목록을 둔 채 loading(placeholderData). 이전 조회가 실패였으면 빈 목록
 * - reload 실패는 처음 상태 + 오류 코드(Query 는 data 를 남기므로 error 상태면 비워서 보여 준다)
 * 요청 번호(seq)로 reload·refresh·조건 변경·기준일 교체 전에 시작한 늦은 응답이 새 결과를 덮지 않게 한다.
 */
export function useGroupRanking(kind: GroupKind) {
  const [period, setPeriod] = useState<Period>('1d');
  const [sort, setSort] = useState<GroupSort>('chg');
  const [more, setMore] = useState<More>(NO_MORE);
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['marketGroups', kind, period, sort] as const, [kind, period, sort]);
  const seq = useRef(0);
  const fetchedAt = useRef<number | null>(null);
  const shownDate = useRef<string | null>(null);

  const fetchFirst = useCallback(async (): Promise<Page> => {
    const r = await stampFetch(fetchedAt, () => fetchMarketGroups(kind, period, sort, 0));
    return {
      items: r.items, total: r.total, date: r.date, hasMore: hasMoreGroups(r.items.length, r.total, r.items.length),
    };
  }, [kind, period, sort]);

  const query = useQuery({
    queryKey,
    queryFn: fetchFirst,
    // 이전 조건 목록을 둔 채 로딩(이전 조회가 실패였으면 이미 비웠으니 넘기지 않음)
    placeholderData: (prev, prevQuery) => (prevQuery?.state.status === 'error' ? undefined : prev),
    structuralSharing: false,
  });

  const fetching = query.fetchStatus === 'fetching';
  const failed = query.status === 'error';
  const shown = failed ? undefined : query.data;
  const items = shown?.items ?? EMPTY;
  const date = shown?.date ?? null;
  const hasMore = shown?.hasMore ?? false;
  const loadingMore = more.key === queryKey && more.loadingMore;
  const moreFailed = more.key === queryKey && more.moreFailed;

  useEffect(() => {
    shownDate.current = date;
  }, [date]);

  useEffect(
    () => () => {
      seq.current += 1; // 언마운트·조건 변경 — 진행 중인 refresh·silentRefresh·더 불러오기 응답은 버린다
    },
    [queryKey],
  );

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setMore((m) => ({ ...m, moreFailed: false }));
    await qc.refetchQueries({ queryKey, exact: true });
    if (id === seq.current) setMore(NO_MORE);
  }, [qc, queryKey]);

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const id = ++seq.current;
    if (qc.getQueryState(queryKey)?.fetchStatus === 'fetching') {
      // 무시하게 된 진행 중 reload 를 대신 끝맺을 때는 reload 실패와 같게(옛 조건 목록·빈 상태 문구 방지).
      // 먼저 취소한다 — data 가 아직 없는 query 는 refetch 가 진행 중 요청에 합쳐질 뿐 새로 받지 않는다
      try {
        await qc.cancelQueries({ queryKey, exact: true });
        await qc.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
      } catch (e) {
        // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
        if (id !== seq.current) return;
        setMore(NO_MORE);
        throw e;
      }
      if (id === seq.current) setMore(NO_MORE);
      return;
    }
    let first: Page;
    try {
      first = await fetchFirst();
    } catch (e) {
      if (id !== seq.current) return;
      // loadMore 만 무시했으면 목록은 두고 표시만 끈다
      setMore((m) => ({ ...m, loadingMore: false }));
      throw e;
    }
    if (id !== seq.current) return;
    qc.setQueryData<Page>(queryKey, first);
    setMore(NO_MORE);
  }, [qc, queryKey, fetchFirst]);

  /**
   * 복귀 재조회 — 순위는 기준일(20:30 갱신)이 바뀔 때만 달라지므로, 기준일이 같으면 더 불러온 목록·스크롤을 그대로 둔다.
   * 기준일이 바뀌었으면 첫 페이지로 교체하고, 진행 중인 더 불러오기·조회 응답은 버린다. 실패는 호출한 쪽이 삼킨다.
   */
  const silentRefresh = useCallback(async () => {
    const id = seq.current;
    const first = await fetchFirst();
    if (id !== seq.current) return;
    if (first.date != null && first.date === shownDate.current) return;
    const id2 = ++seq.current;
    await qc.cancelQueries({ queryKey, exact: true });
    if (id2 !== seq.current) return;
    qc.setQueryData<Page>(queryKey, first);
    setMore(NO_MORE);
  }, [qc, queryKey, fetchFirst]);

  /** 목록 끝에서 다음 30개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (fetching || loadingMore || !hasMore) return;
    const id = seq.current;
    const key = queryKey;
    setMore({ key, loadingMore: true, moreFailed: false });
    try {
      const r = await fetchMarketGroups(kind, period, sort, items.length, GROUP_PAGE);
      if (id !== seq.current) return;
      qc.setQueryData<Page>(key, (prev) => {
        if (!prev) return prev;
        const merged = mergeGroupPage(prev.items, r.items);
        return { ...prev, items: merged, total: r.total, hasMore: hasMoreGroups(merged.length, r.total, r.items.length) };
      });
      setMore({ key, loadingMore: false, moreFailed: false });
    } catch {
      if (id !== seq.current) return;
      setMore({ key, loadingMore: false, moreFailed: true });
    }
  }, [qc, queryKey, kind, period, sort, items.length, fetching, loadingMore, hasMore]);

  return {
    items,
    total: shown?.total ?? 0,
    date,
    hasMore,
    loading: fetching,
    error: !fetching && failed ? errorCode(query.error) : null,
    loadingMore,
    moreFailed,
    period,
    sort,
    setPeriod,
    setSort,
    reload,
    refresh,
    silentRefresh,
    fetchedAt,
    loadMore,
  };
}

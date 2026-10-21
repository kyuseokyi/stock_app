import { useCallback, useEffect, useRef, useState } from 'react';

import { hasMoreLeaders, mergeLeaderPage } from '@/features/leaders/canslim';
import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchFinderScreen } from './api';
import { INITIAL_QUERY, sameFinderQuery, togglePreset } from './finder';
import type { FinderFilters, FinderItem, FinderPreset, FinderQuery, FinderSort } from './types';

type State = {
  items: FinderItem[];
  total: number;
  date: string | null;
  bbSigma: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  items: [], total: 0, date: null, bbSigma: 2, hasMore: false,
  loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 조건검색 목록 — 프리셋·정렬·필터, 50개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영(useCanslimScreen 과 같은 구조) */
export function useFinderScreen() {
  const [query, setQuery] = useState<FinderQuery>(INITIAL_QUERY);
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;
  // 더 불러오기 동기 잠금 — state 는 같은 렌더 안에서 갱신되지 않으므로 ref 로 중복 요청을 막는다
  const inflight = useRef(false);

  // 언마운트 후 도착한 응답이 setState 하지 않게 요청 번호를 올려 모든 진행 중 요청을 옛 것으로 만든다
  useEffect(
    () => () => {
      gate.next();
    },
    [gate],
  );

  const fetchFirst = useCallback(async () => {
    const s = await fetchFinderScreen(query, 0);
    return {
      items: s.items,
      total: s.total,
      date: s.date,
      bbSigma: s.bbSigma,
      hasMore: hasMoreLeaders(s.items.length, s.total, s.items.length),
    };
  }, [query]);

  const reload = useCallback(async () => {
    const id = gate.next();
    inflight.current = false;
    setState((s) => ({ ...s, loading: true, error: null, moreFailed: false }));
    try {
      const first = await fetchFirst();
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, ...first, loading: false });
    } catch (e) {
      if (!gate.isLatest(id)) return;
      setState({ ...INITIAL, loading: false, error: errorCode(e) });
    }
  }, [fetchFirst, gate]);

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw → usePullRefresh 가 토스트) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    inflight.current = false;
    let first: Awaited<ReturnType<typeof fetchFirst>>;
    try {
      first = await fetchFirst();
    } catch (e) {
      // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
      if (!gate.isLatest(id)) return;
      // 진행 중이던 reload 를 대신 끝맺을 때는 reload 실패와 같게, loadMore 만 밀어냈으면 목록은 두고 표시만 끈다
      setState((s) =>
        s.loading ? { ...INITIAL, loading: false, error: errorCode(e) } : { ...s, loadingMore: false },
      );
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /** 목록 끝에서 다음 50개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (inflight.current || state.loading || !state.hasMore) return;
    inflight.current = true;
    const id = gate.current();
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    try {
      const s2 = await fetchFinderScreen(query, state.items.length);
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => {
        const items = mergeLeaderPage(s.items, s2.items);
        return {
          ...s,
          items,
          total: s2.total,
          hasMore: hasMoreLeaders(items.length, s2.total, s2.items.length),
          loadingMore: false,
        };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [gate, query, state.hasMore, state.items.length, state.loading]);

  /** 같은 조건이면 이전 객체를 그대로 돌려줘 다시 조회하지 않는다 */
  const update = useCallback(
    (fn: (q: FinderQuery) => FinderQuery) =>
      setQuery((q) => {
        const next = fn(q);
        return sameFinderQuery(q, next) ? q : next;
      }),
    [],
  );
  const setPreset = useCallback((p: FinderPreset) => update((q) => ({ ...q, preset: togglePreset(q.preset, p) })), [update]);
  const setSort = useCallback((sort: FinderSort) => update((q) => ({ ...q, sort })), [update]);
  const setFilters = useCallback((filters: FinderFilters) => update((q) => ({ ...q, filters })), [update]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, query, setPreset, setSort, setFilters, reload, refresh, loadMore };
}

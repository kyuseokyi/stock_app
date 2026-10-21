import { useCallback, useEffect, useRef, useState } from 'react';

import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchCanslimScreen } from './api';
import { DEFAULT_FILTERS, hasMoreLeaders, mergeLeaderPage, sameFilters } from './canslim';
import type { CanslimItem, CanslimMarket, CanslimSort, ScreenFilters } from './types';

type State = {
  markets: CanslimMarket[];
  items: CanslimItem[];
  total: number;
  date: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  markets: [], items: [], total: 0, date: null, hasMore: false,
  loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 주도주 목록 — 필터·정렬 조건, 50개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영(useGroupRanking 과 같은 구조) */
export function useCanslimScreen() {
  const [filters, setFilters] = useState<ScreenFilters>(DEFAULT_FILTERS);
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;
  // 더 불러오기 동기 잠금 — state 는 같은 렌더 안에서 갱신되지 않으므로 ref 로 중복 요청을 막는다
  const inflight = useRef(false);

  const fetchFirst = useCallback(async () => {
    const { markets, screen } = await fetchCanslimScreen(filters, 0);
    return {
      markets,
      items: screen.items,
      total: screen.total,
      date: screen.date,
      hasMore: hasMoreLeaders(screen.items.length, screen.total, screen.items.length),
    };
  }, [filters]);

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
      const { screen } = await fetchCanslimScreen(filters, state.items.length);
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => {
        const items = mergeLeaderPage(s.items, screen.items);
        return {
          ...s,
          items,
          total: screen.total,
          hasMore: hasMoreLeaders(items.length, screen.total, screen.items.length),
          loadingMore: false,
        };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      inflight.current = false;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [filters, gate, state.hasMore, state.items.length, state.loading]);

  /** 같은 값이면 이전 객체를 그대로 돌려줘 다시 조회하지 않는다 */
  const setSort = useCallback((sort: CanslimSort) => setFilters((f) => (f.sort === sort ? f : { ...f, sort })), []);
  const applyFilters = useCallback((next: ScreenFilters) => setFilters((f) => (sameFilters(f, next) ? f : next)), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, filters, setFilters: applyFilters, setSort, reload, refresh, loadMore };
}

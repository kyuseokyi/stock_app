import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMarketGroups } from './api';
import { errorCode, GROUP_PAGE, hasMoreGroups, mergeGroupPage } from './format';
import { createLatest } from './latest';
import type { GroupItem, GroupKind, GroupSort, Period } from './types';

type State = {
  items: GroupItem[];
  total: number;
  date: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  items: [], total: 0, date: null, hasMore: false, loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 테마·업종 순위 — 기간·정렬 조건, 30개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영 */
export function useGroupRanking(kind: GroupKind) {
  const [period, setPeriod] = useState<Period>('1d');
  const [sort, setSort] = useState<GroupSort>('chg');
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;

  const fetchFirst = useCallback(async () => {
    const r = await fetchMarketGroups(kind, period, sort, 0);
    return {
      items: r.items, total: r.total, date: r.date, hasMore: hasMoreGroups(r.items.length, r.total, r.items.length),
    };
  }, [kind, period, sort]);

  const reload = useCallback(async () => {
    const id = gate.next();
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

  /** 당겨서 새로고침 — 기존 목록 유지, 성공하면 첫 페이지로 교체(실패는 throw) */
  const refresh = useCallback(async () => {
    const id = gate.next();
    let first: Awaited<ReturnType<typeof fetchFirst>>;
    try {
      first = await fetchFirst();
    } catch (e) {
      // 번호를 올려 무시하게 된 진행 중 reload·loadMore 의 표시가 남지 않게 끈다
      if (gate.isLatest(id)) setState((s) => ({ ...s, loading: false, loadingMore: false }));
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /** 목록 끝에서 다음 30개 — 번호를 올리지 않고 지금 조건의 응답일 때만 반영 */
  const loadMore = useCallback(async () => {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    const id = gate.current();
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    try {
      const r = await fetchMarketGroups(kind, period, sort, state.items.length, GROUP_PAGE);
      if (!gate.isLatest(id)) return;
      setState((s) => {
        const items = mergeGroupPage(s.items, r.items);
        return { ...s, items, total: r.total, hasMore: hasMoreGroups(items.length, r.total, r.items.length), loadingMore: false };
      });
    } catch {
      if (!gate.isLatest(id)) return;
      setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
    }
  }, [gate, kind, period, sort, state.hasMore, state.items.length, state.loading, state.loadingMore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, period, sort, setPeriod, setSort, reload, refresh, loadMore };
}

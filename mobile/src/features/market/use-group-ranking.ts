import { useCallback, useEffect, useRef, useState } from 'react';

import { stampFetch } from './auto-refresh';
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
  const fetchedAt = useRef<number | null>(null);
  const shownDate = useRef<string | null>(null);
  useEffect(() => {
    shownDate.current = state.date;
  }, [state.date]);

  const fetchFirst = useCallback(async () => {
    const r = await stampFetch(fetchedAt, () => fetchMarketGroups(kind, period, sort, 0));
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
      // 더 새 요청에 밀렸으면 그쪽이 상태를 정한다
      if (!gate.isLatest(id)) return;
      // 무시하게 된 진행 중 reload 를 대신 끝맺을 때는 reload 실패와 같게(옛 조건 목록·빈 상태 문구 방지),
      // loadMore 만 무시했으면 목록은 두고 표시만 끈다
      setState((s) =>
        s.loading ? { ...INITIAL, loading: false, error: errorCode(e) } : { ...s, loadingMore: false },
      );
      throw e;
    }
    if (!gate.isLatest(id)) return;
    setState({ ...INITIAL, ...first, loading: false });
  }, [fetchFirst, gate]);

  /**
   * 복귀 재조회 — 순위는 기준일(20:30 갱신)이 바뀔 때만 달라지므로, 기준일이 같으면 더 불러온 목록·스크롤을 그대로 둔다.
   * 기준일이 바뀌었으면 첫 페이지로 교체하고, 진행 중인 더 불러오기 응답은 버린다. 실패는 호출한 쪽이 삼킨다.
   */
  const silentRefresh = useCallback(async () => {
    const id = gate.current();
    const first = await fetchFirst();
    if (!gate.isLatest(id)) return;
    if (first.date != null && first.date === shownDate.current) return;
    gate.next();
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

  return { ...state, period, sort, setPeriod, setSort, reload, refresh, silentRefresh, fetchedAt, loadMore };
}

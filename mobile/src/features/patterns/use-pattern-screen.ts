import { useCallback, useEffect, useRef, useState } from 'react';

import { hasMoreLeaders, mergeLeaderPage } from '@/features/leaders/canslim';
import { errorCode } from '@/features/market/format';
import { createLatest } from '@/features/market/latest';

import { fetchPatternScreen } from './api';
import { INITIAL_PATTERN_QUERY, samePatternQuery, togglePatternType } from './patterns';
import type { PatternItem, PatternQuery, PatternReport, PatternType } from './types';

type State = {
  items: PatternItem[];
  total: number;
  date: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
};

const INITIAL: State = {
  items: [], total: 0, date: null, hasMore: false,
  loading: true, error: null, loadingMore: false, moreFailed: false,
};

/** 차트 패턴 목록 — 리포트·패턴 칩, 50개씩 더 불러오기, 조건을 빠르게 바꿔도 마지막 요청만 반영(useFinderScreen 과 같은 구조) */
export function usePatternScreen() {
  const [query, setQuery] = useState<PatternQuery>(INITIAL_PATTERN_QUERY);
  const [state, setState] = useState<State>(INITIAL);
  const gate = useRef(createLatest()).current;
  // 더 불러오기 동기 잠금 — state 는 같은 렌더 안에서 갱신되지 않으므로 ref 로 중복 요청을 막는다
  const inflight = useRef(false);

  useEffect(
    () => () => {
      gate.next();
    },
    [gate],
  );

  const fetchFirst = useCallback(async () => {
    const s = await fetchPatternScreen(query, 0);
    return {
      items: s.items,
      total: s.total,
      date: s.date,
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
      if (!gate.isLatest(id)) return;
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
      const s2 = await fetchPatternScreen(query, state.items.length);
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
    (fn: (q: PatternQuery) => PatternQuery) =>
      setQuery((q) => {
        const next = fn(q);
        return samePatternQuery(q, next) ? q : next;
      }),
    [],
  );
  const setReport = useCallback((report: PatternReport) => update((q) => ({ ...q, report })), [update]);
  const togglePattern = useCallback(
    (t: PatternType) => update((q) => ({ ...q, patternType: togglePatternType(q.patternType, t) })),
    [update],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, query, setReport, togglePattern, reload, refresh, loadMore };
}

import { useCallback, useEffect, useState } from 'react';

import { fetchMarketGroup } from './api';
import { errorCode } from './format';
import type { GroupDetail, GroupKind } from './types';

type State = { data: GroupDetail | null; loading: boolean; error: string | null; notFound: boolean };

export function useGroupDetail(kind: GroupKind, id: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null, notFound: false });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchMarketGroup(kind, id);
      setState({ data, loading: false, error: null, notFound: data === null });
    } catch (e) {
      setState({ data: null, loading: false, error: errorCode(e), notFound: false });
    }
  }, [kind, id]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw) */
  const refresh = useCallback(async () => {
    const data = await fetchMarketGroup(kind, id);
    setState({ data, loading: false, error: null, notFound: data === null });
  }, [kind, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}

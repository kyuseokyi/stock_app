import { useCallback, useEffect, useState } from 'react';

import { errorCode } from '@/features/market/format';

import { fetchCanslimScore } from './api';
import type { CanslimScore } from './types';

type State = { data: CanslimScore | null; loading: boolean; error: string | null };

/** 종목 점수표 — data null + 오류 없음 = 분석 비대상(scoreView 가 'none'). 차트 조회와는 독립 */
export function useCanslimScore(ticker: string) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchCanslimScore(ticker);
      setState({ data, loading: false, error: null });
    } catch (e) {
      // 이미 보이던 점수표는 남긴다(scoreView 는 data 가 있으면 ready)
      setState((s) => ({ data: s.data, loading: false, error: errorCode(e) }));
    }
  }, [ticker]);

  /** 당겨서 새로고침 — 기존 내용 유지(실패는 throw → 토스트) */
  const refresh = useCallback(async () => {
    const data = await fetchCanslimScore(ticker);
    setState({ data, loading: false, error: null });
  }, [ticker]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
